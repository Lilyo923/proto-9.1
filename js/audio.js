/* =============================================================================
   BRAD BITT, MAIS LE JEU — son

   Deux mecanismes distincts :

   - La MUSIQUE passe par un element <audio>. Les pistes font environ 2 min 20
     et 2,3 Mo : les charger dans la memoire du contexte Web Audio serait du
     gaspillage, alors qu'un element <audio> se contente de diffuser.
   - Les EFFETS sont synthetises a la volee en Web Audio. Aucun fichier a
     telecharger, et ils restent faciles a remplacer par de vrais sons plus
     tard : il suffira d'echanger le corps de `bruit()`.

   Les navigateurs interdisent toute lecture audio tant que l'utilisateur n'a
   pas interagi avec la page. C'est la raison d'etre du bouton « Jouer » de
   l'ecran d'accueil : il appelle `audio.debloquer()`.
   ========================================================================== */
'use strict';

const audio = {
  ac: null,                 // AudioContext, cree au premier geste utilisateur
  sortieEffets: null,       // gain maitre des effets
  debloque: false,

  pistes: new Map(),        // src -> HTMLAudioElement
  musique: null,            // piste en cours
  cible: 0,                 // volume vise, pour les fondus
  vitesseFondu: 1,

  /* Silence entre deux passages du morceau. Les pistes durent 2 min 20 et
     n'ont pas ete composees pour boucler : les enchainer bord a bord ferait
     entendre la couture a chaque tour. On laisse donc respirer, puis on
     revient en fondu. */
  pauseMin: 10,
  pauseMax: 15,
  attente: 0,               // secondes restantes avant la reprise
  enPause: false,

  /* --- Deblocage ------------------------------------------------------- */

  debloquer() {
    if (this.debloque) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ac = new AC();
        this.sortieEffets = this.ac.createGain();
        this.sortieEffets.gain.value = R.volEffets;
        this.sortieEffets.connect(this.ac.destination);
        if (this.ac.state === 'suspended') this.ac.resume();
      }
      this.debloque = true;
    } catch (e) {
      // Pas de Web Audio : le jeu reste parfaitement jouable, en silence.
      this.debloque = true;
    }
  },

  /* --- Musique --------------------------------------------------------- */

  precharger(src) {
    return new Promise(resoudre => {
      let el;
      try { el = new Audio(); } catch (e) { return resoudre(); }
      el.preload = 'auto';
      el.loop = true;
      el.volume = 0;
      // `canplaythrough` peut ne jamais arriver selon le navigateur et la
      // politique de lecture : on resout aussi sur `loadeddata` et sur un
      // delai de securite, pour qu'un chargement ne bloque jamais le menu.
      const fini = () => { this.pistes.set(src, el); resoudre(); };
      el.addEventListener('canplaythrough', fini, { once: true });
      el.addEventListener('loadeddata', fini, { once: true });
      el.addEventListener('error', () => resoudre(), { once: true });
      // Fin du morceau : on n'enchaine pas, on programme une reprise differee.
      el.addEventListener('ended', () => {
        if (this.musique !== el) return;
        this.enPause = true;
        this.attente = this.pauseMin + Math.random() * (this.pauseMax - this.pauseMin);
        el.currentTime = 0;
      });
      setTimeout(fini, 12000);
      el.src = src;
      el.load();
    });
  },

  jouerMusique(src, fondu) {
    if (!this.debloque) return;
    const el = this.pistes.get(src);
    if (!el) return;
    if (this.musique && this.musique !== el) this.musique.pause();
    this.musique = el;
    el.loop = false;               // la reprise est geree a la main, avec pause
    this.enPause = false;
    this.attente = 0;
    this.cible = R.volMusique;
    this.vitesseFondu = fondu === 0 ? 99 : 1 / (fondu || 1.2);
    if (fondu === 0) el.volume = Math.min(1, R.volMusique);
    const p = el.play();
    if (p && p.catch) p.catch(() => { /* lecture refusee : on reste muet */ });
  },

  arreterMusique(fondu) {
    this.cible = 0;
    this.enPause = false;
    this.attente = 0;
    this.vitesseFondu = fondu === 0 ? 99 : 1 / (fondu || 0.8);
    if (fondu === 0 && this.musique) { this.musique.pause(); this.musique.volume = 0; }
  },

  /* Fondus appliques image par image, plutot qu'avec un setInterval : le son
     reste synchronise avec le jeu, y compris quand l'onglet est en pause. */
  maj(dt) {
    if (this.sortieEffets) this.sortieEffets.gain.value = R.volEffets;
    const m = this.musique;
    if (!m) return;

    // Silence programme entre deux passages, puis reprise en fondu long.
    if (this.enPause) {
      this.attente -= dt;
      m.volume = 0;
      if (this.attente <= 0) {
        this.enPause = false;
        this.vitesseFondu = 1 / 3.5;      // remontee douce sur 3,5 s
        const p = m.play();
        if (p && p.catch) p.catch(() => {});
      }
      return;
    }

    const plafond = Math.max(0, Math.min(1, this.cible));
    const pas = this.vitesseFondu * dt;
    if (m.volume < plafond) m.volume = Math.min(plafond, m.volume + pas);
    else if (m.volume > plafond) m.volume = Math.max(plafond, m.volume - pas);
    if (m.volume <= 0 && plafond === 0 && !m.paused) m.pause();
  },

  /* --- Effets ---------------------------------------------------------- */

  /* Enveloppe simple : une oscillation qui glisse d'une frequence a une autre
     et s'eteint. Suffisant pour des retours sonores lisibles. */
  ton({ de, vers, duree, forme, gain, retard }) {
    if (!this.ac || R.volEffets <= 0) return;
    const t0 = this.ac.currentTime + (retard || 0);
    const osc = this.ac.createOscillator();
    const g = this.ac.createGain();
    osc.type = forme || 'square';
    osc.frequency.setValueAtTime(de, t0);
    if (vers && vers !== de) osc.frequency.exponentialRampToValueAtTime(Math.max(1, vers), t0 + duree);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain === undefined ? 0.25 : gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
    osc.connect(g); g.connect(this.sortieEffets);
    osc.start(t0);
    osc.stop(t0 + duree + 0.02);
  },

  souffle({ duree, gain, filtre }) {
    if (!this.ac || R.volEffets <= 0) return;
    const n = Math.floor(this.ac.sampleRate * duree);
    const tampon = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const d = tampon.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ac.createBufferSource();
    src.buffer = tampon;
    const bp = this.ac.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = filtre || 1200;
    const g = this.ac.createGain();
    g.gain.value = gain === undefined ? 0.2 : gain;
    src.connect(bp); bp.connect(g); g.connect(this.sortieEffets);
    src.start();
  },

  bruit(nom) {
    if (!this.ac) return;
    switch (nom) {
      case 'saut':    this.ton({ de: 300, vers: 620, duree: 0.12, forme: 'square', gain: 0.16 }); break;
      case 'ecrase':  this.ton({ de: 420, vers: 120, duree: 0.14, forme: 'square', gain: 0.24 });
                      this.souffle({ duree: 0.12, gain: 0.16, filtre: 900 }); break;
      case 'coup':    this.ton({ de: 190, vers: 90, duree: 0.09, forme: 'sawtooth', gain: 0.2 }); break;
      case 'blinde':  this.ton({ de: 240, vers: 210, duree: 0.09, forme: 'square', gain: 0.12 });
                      this.souffle({ duree: 0.07, gain: 0.1, filtre: 2600 }); break;
      case 'degat':   this.ton({ de: 320, vers: 70, duree: 0.28, forme: 'sawtooth', gain: 0.26 }); break;
      case 'piece':   this.ton({ de: 990, vers: 990, duree: 0.06, forme: 'square', gain: 0.14 });
                      this.ton({ de: 1480, vers: 1480, duree: 0.1, forme: 'square', gain: 0.12, retard: 0.055 }); break;
      case 'soin':    this.ton({ de: 520, vers: 780, duree: 0.16, forme: 'triangle', gain: 0.18 }); break;
      case 'onde':    this.ton({ de: 180, vers: 900, duree: 0.32, forme: 'sawtooth', gain: 0.22 });
                      this.souffle({ duree: 0.35, gain: 0.18, filtre: 1800 }); break;
      case 'mort':    this.ton({ de: 420, vers: 60, duree: 0.7, forme: 'square', gain: 0.26 }); break;
      case 'menu':    this.ton({ de: 620, vers: 620, duree: 0.05, forme: 'square', gain: 0.1 }); break;
      case 'valider': this.ton({ de: 660, vers: 990, duree: 0.13, forme: 'square', gain: 0.16 }); break;
      case 'refus':   this.ton({ de: 220, vers: 160, duree: 0.14, forme: 'square', gain: 0.14 }); break;
      case 'transition': this.souffle({ duree: 0.5, gain: 0.2, filtre: 700 });
                      this.ton({ de: 140, vers: 70, duree: 0.5, forme: 'sine', gain: 0.14 }); break;
      case 'porte':   this.ton({ de: 500, vers: 760, duree: 0.18, forme: 'triangle', gain: 0.2 });
                      this.ton({ de: 760, vers: 1200, duree: 0.28, forme: 'triangle', gain: 0.18, retard: 0.16 }); break;
      case 'victoire':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.ton({ de: f, vers: f, duree: 0.3, forme: 'square', gain: 0.16, retard: i * 0.13 }));
        break;
    }
  },
};
