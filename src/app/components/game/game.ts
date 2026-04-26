import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SongService, AnimeSong } from '../../services/song';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import { TOP_ANIME } from '../../services/top_anime';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './game.html',
  styleUrls: ['./game.scss']
})
export class Game implements OnInit, OnDestroy {
  mode: 'random' | 'top' | 'seasonal' | 'anilist' | '' = '';
  gameStyle: 'classic' | 'multiple-choice' | '' = '';
  gameType: 'audio' | 'characters' | 'higher-lower-score' | 'higher-lower-pop' | '' = '';
  anilistUsername: string = '';
  activeAnilistUsername: string = '';
  isAnilistLoading: boolean = false;
  
  currentSong: AnimeSong | null = null;
  nextSong: AnimeSong | null = null;
  higherLowerState: 'guessing' | 'revealed' = 'guessing';
  multipleChoiceOptions: {name: string, imageUrl: string, isCorrect: boolean}[] = [];
  localAnimeData: {name: string, synonyms: string[], imageUrl: string}[] = [];
  guesses: string[] = [];
  
  level: number = 1;
  maxLevels: number = 6;
  guess: string = '';
  filteredNames: {title: string, imageUrl: string}[] = [];
  hasSelectedGuess: boolean = false;
  isMenuOpen: boolean = false;
  
  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  gameStatus: 'setup' | 'loading' | 'playing' | 'won' | 'lost' | 'error' | 'finished' = 'setup';
  errorMessage: string = '';

  currentRound: number = 1;
  maxRounds: number = 10;
  score: number = 0;
  playedAnimeNames: string[] = [];

  currentTime: number = 0;
  startOffset: number = 0;
  volume: number = 0.5;
  isPlaying: boolean = false;
  isBuffering: boolean = false;
  showWrongFeedback: boolean = false;
  showCloseFeedback: boolean = false;
  
  private audio: HTMLAudioElement | null = null;
  private progressInterval: any;

  constructor(public songService: SongService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.gameStatus = 'setup';
    console.log('ngOnInit: waiting for user setup');
    
    // Inizializza il motore di ricerca online con RxJS
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(term => this.songService.searchAnime(term))
    ).subscribe(nomi => {
      // Includiamo anche i risultati locali per garantire che la risposta corretta sia trovabile
      const termLower = this.guess.trim().toLowerCase();
      const localMatches: {title: string, imageUrl: string}[] = [];
      
      this.localAnimeData.forEach(a => {
        if (a.name.toLowerCase().includes(termLower)) {
          localMatches.push({title: a.name, imageUrl: a.imageUrl});
        } else if (a.synonyms && a.synonyms.some(syn => syn.toLowerCase().includes(termLower))) {
          // Se un sinonimo matcha, suggerisci il VERO NOME DELL'ANIME (es. DanMachi -> Dungeon ni Deai...)
          localMatches.push({title: a.name, imageUrl: a.imageUrl});
        }
      });

      // Mappa per unire e rimuovere i duplicati in base al titolo
      const combinedMap = new Map<string, {title: string, imageUrl: string}>();
      
      localMatches.forEach(item => combinedMap.set(item.title, item));
      nomi.forEach(item => {
        // Se esiste già lo aggiorno solo se il nuovo ha l'immagine e il vecchio no
        if (!combinedMap.has(item.title) || (!combinedMap.get(item.title)?.imageUrl && item.imageUrl)) {
          combinedMap.set(item.title, item);
        }
      });

      this.filteredNames = Array.from(combinedMap.values()).sort((a, b) => {
        const aLower = a.title.toLowerCase();
        const bLower = b.title.toLowerCase();
        const aStarts = aLower.startsWith(termLower);
        const bStarts = bLower.startsWith(termLower);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aLower.localeCompare(bLower);
      }).slice(0, 15);
      
      this.cdr.detectChanges();
    });
  }

  startGameFromSetup(): void {
    if (!this.gameType) return;
    if (!this.gameType.startsWith('higher-lower')) {
      if (!this.mode || !this.gameStyle) return;
    }
    if (this.mode === 'anilist' && !this.anilistUsername.trim()) {
      return;
    }
    
    this.activeAnilistUsername = this.anilistUsername.trim();
    if (this.mode === 'anilist') {
      this.isAnilistLoading = true;
    }
    this.restartGame();
  }

  setMode(newMode: 'random' | 'top' | 'seasonal' | 'anilist'): void {
    this.mode = newMode;
    if (newMode === 'anilist') {
      this.isAnilistLoading = false;
    }
  }

  setGameStyle(newStyle: 'classic' | 'multiple-choice'): void {
    this.gameStyle = newStyle;
  }

  setGameType(newType: 'audio' | 'characters' | 'higher-lower-score' | 'higher-lower-pop'): void {
    this.gameType = newType;
  }

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  applySettings(): void {
    if (!this.gameType) return;
    if (!this.gameType.startsWith('higher-lower')) {
      if (!this.mode || !this.gameStyle) return;
    }
    if (this.mode === 'anilist' && !this.anilistUsername.trim()) return;
    
    this.activeAnilistUsername = this.anilistUsername.trim();
    this.isMenuOpen = false;
    this.restartGame();
  }

  startAnilistGame(): void {
    if (!this.anilistUsername.trim()) return;
    this.activeAnilistUsername = this.anilistUsername.trim();
    this.isAnilistLoading = true;
    this.restartGame();
  }

  restartGame(): void {
    this.stopAudio();
    this.currentRound = 1;
    this.score = 0;
    this.playedAnimeNames = [];
    
    if (this.mode === 'anilist' && !this.anilistUsername.trim()) {
      this.gameStatus = 'setup';
      return;
    }
    
    this.gameStatus = 'loading';
    this.cdr.detectChanges();
    this.loadSongsForGame(this.mode as any);
  }

  private loadSongsForGame(mode: 'random' | 'top' | 'seasonal' | 'anilist'): void {
    if (mode === 'anilist' && !this.anilistUsername.trim()) {
       // Se siamo in modalità AniList ma manca l'username, non far partire la ricerca.
       return;
    }
    
    const requestedMode = mode;

    this.songService.loadSongs(30, mode, this.anilistUsername, this.gameType as any).subscribe({
      next: (success) => {
        if (this.mode !== requestedMode) {
          this.cdr.detectChanges();
          return;
        }
        console.log('loadSongs resolved with success =', success);
        if (!success || this.songService.errorMessage || !this.songService.isSongsReady()) {
          this.gameStatus = 'error';
          this.errorMessage = this.songService.errorMessage || `No songs found for ${mode} mode.`;
        } else {
          this.localAnimeData = this.songService.getLocalAnimeData();
          this.maxRounds = Math.min(10, Math.max(1, this.localAnimeData.length));
          this.currentRound = 1;
          this.score = 0;
          this.startNewGame();
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('loadSongs Observable subscription generated a fatal error:', err);
        this.gameStatus = 'error';
        this.errorMessage = 'Fatal error starting game: ' + (err.message || err);
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    this.stopAudio();
  }

  startNewGame(): void {
    if (this.currentRound > this.maxRounds) {
        this.gameStatus = 'finished';
        this.stopAudio();
        this.cdr.detectChanges();
        return;
    }

    if (this.songService.isSongsExhausted()) {
      // Quando finiamo tutte le canzoni preparate, mostriamo il loader ed eseguiamo un nuovo fetch remoto!
      this.stopAudio();
      this.gameStatus = 'loading';
      this.cdr.detectChanges();
      this.loadSongsForGame(this.mode as any);
      return; // "loadSongsForGame" richiamerà startNewGame() da solo quando finirà il download.
    }

    if (!this.songService.isSongsReady()) return;
    
    this.stopAudio();
    this.currentSong = this.songService.getRandomSong();
    this.level = 1;
    this.guess = '';
    this.guesses = [];
    this.currentTime = 0;
    this.startOffset = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.showWrongFeedback = false;
    this.hasSelectedGuess = false;
    this.gameStatus = 'playing';

    if (this.gameType.startsWith('higher-lower')) {
      this.nextSong = this.songService.getRandomSong();
      this.higherLowerState = 'guessing';
      return;
    }
    
    if (this.currentSong) {
      this.playedAnimeNames.push(this.currentSong.name);
      if (this.gameStyle === 'multiple-choice') {
        this.generateMultipleChoiceOptions();
      }

      if (this.gameType === 'audio') {
        this.audio = new Audio(this.currentSong.url);
        this.audio.volume = this.volume;
      // Preload data
      this.audio.preload = 'auto';

      this.audio.onloadedmetadata = () => {
        if (this.audio) {
          // Salta i primi N secondi (ci sono spesso loghi o silenzi)
          // E fissa un punto di partenza casuale per rendere il gioco dinamico
          if (this.audio.duration > 35) {
            const minStart = 10; // Almeno 10 secondi dopo l'inizio
            const maxStart = this.audio.duration - 20; // Almeno 20s prima della fine
            this.startOffset = minStart + Math.random() * (maxStart - minStart);
          } else {
            this.startOffset = 0;
          }
          
          // Imposta subito il tempo così il browser precarica (bufferizza) 
          // direttamente la parte della canzone che serve!
          this.audio.currentTime = this.startOffset;
        }
      };
      
      // Events for buffering
      this.audio.onwaiting = () => {
        this.isBuffering = true;
        this.cdr.detectChanges();
      };
      this.audio.oncanplay = () => {
        this.isBuffering = false;
        this.cdr.detectChanges();
      };
      this.audio.onplaying = () => {
        this.isBuffering = false;
        this.cdr.detectChanges();
      };
      
      this.audio.load();
      } else {
        this.isPlaying = true;
        this.isBuffering = false;
      }
    }
  }

  onVolumeChange(): void {
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }

  getPlayDuration(): number {
    if (this.gameStyle === 'multiple-choice') {
      return 15.0;
    }
    const durations = [0.1, 0.5, 2.0, 4.0, 8.0, 15.0];
    return durations[this.level - 1] || 15.0;
  }

  formatTime(time: number): string {
    const s = Math.floor(time);
    const ms = Math.floor((time % 1) * 100);
    const paddedS = s < 10 ? '0' + s : s.toString();
    const paddedMs = ms < 10 ? '0' + ms : ms.toString();
    return `${paddedS}:${paddedMs}`;
  }

  togglePlay(): void {
    if (this.gameType === 'characters') return;
    if (!this.audio) return;
    
    // Se sta già suonando, mettiamo in pausa
    if (this.isPlaying) {
      this.stopAudio();
      return;
    }

    // Inizializza temporaneamente l'interfaccia utente a "in caricamento" (se necessario)
    this.isPlaying = true;
    if (this.audio.readyState < 3) {
      this.isBuffering = true;
    }
    
    // Tenta di posizionare il cursore temporale solo se ci siamo allontanati
    // Questo evita di forzare il browser a fare una nuova richiesta di Range azzerando la latenza!
    try {
      if (Math.abs(this.audio.currentTime - this.startOffset) > 0.05) {
        this.audio.currentTime = this.startOffset;
      }
    } catch (e) {
      // Ignora e continua
    }

    this.currentTime = 0; // Azzera subito per evitare ExpressionChangedAfterItHasBeenCheckedError
    const playPromise = this.audio.play();

    if (playPromise !== undefined) {
      playPromise.then(() => {
          // L'audio è EFFETTIVAMENTE partito dalle casse!
          // Memorizza il VERO tempo di partenza (dopo tutti i buffering e ritardi)
          const realStartTime = this.audio!.currentTime;
          this.currentTime = 0;
          this.isBuffering = false;

          const durationMs = this.getPlayDuration() * 1000;

          // Fai partire il timer che ferma l'audio!
          this.progressInterval = setInterval(() => {
              if (this.audio) {
                  this.currentTime = Math.max(0, this.audio.currentTime - realStartTime);

                  if (this.currentTime * 1000 >= durationMs) {
                      this.currentTime = this.getPlayDuration();
                      this.stopAudio();
                  }

                  this.cdr.detectChanges(); // Effettua la CD dopo aver fatto le modifiche!
              }
          }, 15);
      }).catch(e => {
          console.error("Audio play blocked by browser:", e);
          this.isPlaying = false;
          this.isBuffering = false;
          this.cdr.detectChanges();
      });
    }
  }

  stopAudio(): void {
    this.isPlaying = false;
    this.isBuffering = false;
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    if (this.audio) {
      this.audio.pause();
    }
    this.cdr.detectChanges(); // Assicurarsi che l'icona torni su 'Play'
  }

  onSearchChange(): void {
    const term = this.guess.trim().toLowerCase();
    this.hasSelectedGuess = false; // Se l'utente digita, invalida la selezione
    
    if (!term) {
      this.filteredNames = [];
      return;
    }
    
    // Invia il termine di ricerca all'osservabile (con RxJS e chiamate server)
    this.searchSubject.next(term);
  }

  selectGuess(name: string): void {
    this.guess = name;
    this.hasSelectedGuess = true;
    this.filteredNames = [];
  }

  submitGuess(): void {
    if (this.gameStatus !== 'playing') return;
    if (!this.guess.trim() || !this.hasSelectedGuess) return;
    
    const guessedName = this.guess.toLowerCase().trim();
    const correctName = (this.currentSong?.name || '').toLowerCase().trim();
    const synonyms = (this.currentSong?.synonyms || []).map(s => s.toLowerCase().trim());

    if (guessedName === correctName || synonyms.includes(guessedName)) {
      this.guesses.push(this.guess);
      this.score++; // INCREMENT SCORE!
      this.gameStatus = 'won';
    } else if (this.isCloseGuess(this.guess)) {
      this.guesses.push(this.guess);
      this.triggerCloseFeedback();
      this.wrongGuessOrSkip();
    } else {
      this.guesses.push(this.guess);
      this.triggerWrongFeedback();
      this.wrongGuessOrSkip();
    }
  }

  submitHigherLower(guess: 'higher' | 'lower'): void {
    if (this.higherLowerState !== 'guessing' || !this.currentSong || !this.nextSong) return;
    
    this.higherLowerState = 'revealed';
    
    let isCorrect = false;
    const metric = this.gameType === 'higher-lower-score' ? 'averageScore' : 'popularity';
    const valA = this.currentSong[metric] || 0;
    const valB = this.nextSong[metric] || 0;

    if (guess === 'higher') {
      isCorrect = valB >= valA;
    } else {
      isCorrect = valB <= valA;
    }

    if (isCorrect) {
      this.score++;
      setTimeout(() => {
        if (this.songService.isSongsExhausted()) {
          this.gameStatus = 'loading';
          this.cdr.detectChanges();
          this.loadSongsForGame(this.mode as any);
        } else {
          this.currentSong = this.nextSong;
          this.nextSong = this.songService.getRandomSong();
          this.higherLowerState = 'guessing';
          this.cdr.detectChanges();
        }
      }, 2000);
    } else {
      setTimeout(() => {
        this.gameStatus = 'finished';
        this.cdr.detectChanges();
      }, 2000);
    }
  }

  private normalizeTitle(title: string): string {
    return title ? title.toLowerCase().replace(/[^a-z0-9]/gi, '') : '';
  }

  generateMultipleChoiceOptions(): void {
    if (!this.currentSong) return;
    
    const correctName = this.currentSong.name;
    const correctImage = this.currentSong.imageUrl || '';
    const options = [{ name: correctName, imageUrl: correctImage, isCorrect: true }];
    
    // Mappa per avere normalizedName -> { name, imageUrl }
    const availableOptions = new Map<string, {name: string, imageUrl: string}>();
    
    if (this.mode === 'anilist' && this.songService.userAnilist && this.songService.userAnilist.length > 0) {
      this.songService.userAnilist.forEach(a => availableOptions.set(this.normalizeTitle(a.title), {name: a.title, imageUrl: a.imageUrl}));
      if (this.songService.userAnilist.length < 150) {
        this.songService.wrongAnswersPool.forEach(a => availableOptions.set(this.normalizeTitle(a.title), {name: a.title, imageUrl: a.imageUrl}));
      }
    } else if (this.mode === 'seasonal') {
      this.localAnimeData.forEach(a => availableOptions.set(this.normalizeTitle(a.name), {name: a.name, imageUrl: a.imageUrl}));
      this.songService.seasonalWrongAnswersPool.forEach(a => availableOptions.set(this.normalizeTitle(a.title), {name: a.title, imageUrl: a.imageUrl}));
    } else {
      this.localAnimeData.forEach(a => availableOptions.set(this.normalizeTitle(a.name), {name: a.name, imageUrl: a.imageUrl}));
      this.songService.wrongAnswersPool.forEach(a => availableOptions.set(this.normalizeTitle(a.title), {name: a.title, imageUrl: a.imageUrl}));
    }
    
    availableOptions.delete(this.normalizeTitle(correctName));
    this.playedAnimeNames.forEach(name => availableOptions.delete(this.normalizeTitle(name)));
    
    const synonyms = (this.currentSong?.synonyms || []).map(s => this.normalizeTitle(s));
    synonyms.forEach(syn => availableOptions.delete(syn));
    
    const playedLower = this.playedAnimeNames.map(p => this.normalizeTitle(p));
    if (availableOptions.size < 3) {
      TOP_ANIME.forEach(a => { 
        const normA = this.normalizeTitle(a);
        if (!availableOptions.has(normA) && normA !== this.normalizeTitle(correctName) && !playedLower.includes(normA) && !synonyms.includes(normA)) {
          availableOptions.set(normA, {name: a, imageUrl: ''});
        }
      });
    }
    
    const availableArray = Array.from(availableOptions.values());
    
    while (options.length < 4 && availableArray.length > 0) {
      const idx = Math.floor(Math.random() * availableArray.length);
      options.push({ name: availableArray[idx].name, imageUrl: availableArray[idx].imageUrl, isCorrect: false });
      availableArray.splice(idx, 1);
    }
    
    this.multipleChoiceOptions = options.sort(() => Math.random() - 0.5);
  }

  submitMultipleChoice(option: {name: string, imageUrl?: string, isCorrect: boolean}): void {
    if (this.gameStatus !== 'playing') return;
    this.stopAudio();
    this.guess = option.name;
    this.guesses.push(this.guess);
    
    if (option.isCorrect) {
      this.score++;
      this.gameStatus = 'won';
    } else {
      this.triggerWrongFeedback(); // opzionalmente possiamo mostrare un feedback
      this.gameStatus = 'lost';
    }
  }

  isCloseGuess(guess: string): boolean {
    if (!guess || !this.currentSong?.name) return false;
    const guessedName = guess.toLowerCase().trim();
    const correctName = this.currentSong.name.toLowerCase().trim();
    const synonyms = (this.currentSong?.synonyms || []).map(s => s.toLowerCase().trim());

    if (guessedName === correctName || synonyms.includes(guessedName)) return false;

    if (guessedName.length > 2 && (correctName.startsWith(guessedName) || guessedName.startsWith(correctName))) return true;

    for (const syn of synonyms) {
      if (guessedName.length > 2 && (syn.startsWith(guessedName) || guessedName.startsWith(syn))) {
        return true;
      }
    }

    return false;
  }

  skip(): void {
    if (this.gameStatus !== 'playing') return;
    this.guesses.push('Skipped');
    this.wrongGuessOrSkip();
  }

  private triggerCloseFeedback(): void {
    this.showCloseFeedback = true;
    setTimeout(() => {
      this.showCloseFeedback = false;
      this.cdr.detectChanges();
    }, 1500);
  }

  private triggerWrongFeedback(): void {
    this.showWrongFeedback = true;
    setTimeout(() => {
      this.showWrongFeedback = false;
      this.cdr.detectChanges();
    }, 1500);
  }

  private wrongGuessOrSkip(): void {
    if (this.level < this.maxLevels) {
      this.level++;
      this.guess = '';
      this.filteredNames = [];
      this.stopAudio();
      this.currentTime = 0;
    } else {
      this.gameStatus = 'lost';
    }
  }
  
  playNextSongInRound(): void {
    if (this.currentRound < this.maxRounds) {
        this.currentRound++;
        this.startNewGame();
    } else {
        this.currentRound++; // per far triggerare il return nella sub-routine
        this.startNewGame();
    }
  }

  retryLoad(): void {
    this.songService['isReady'] = false;
    this.songService['isLoading'] = false;
    this.ngOnInit();
  }
}
