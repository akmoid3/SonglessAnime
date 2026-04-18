import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SongService, AnimeSong } from '../../services/song';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './game.html',
  styleUrls: ['./game.scss']
})
export class Game implements OnInit, OnDestroy {
  mode: 'random' | 'top' | 'seasonal' = 'random';
  
  currentSong: AnimeSong | null = null;
  allAnimeNames: string[] = []; // Nomi locali dei 30 attuali
  guesses: string[] = [];
  
  level: number = 1;
  maxLevels: number = 6;
  guess: string = '';
  filteredNames: string[] = [];
  hasSelectedGuess: boolean = false;
  
  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  gameStatus: 'loading' | 'playing' | 'won' | 'lost' | 'error' | 'finished' = 'loading';
  errorMessage: string = '';

  currentRound: number = 1;
  maxRounds: number = 10;
  score: number = 0;

  currentTime: number = 0;
  startOffset: number = 0;
  volume: number = 0.5;
  isPlaying: boolean = false;
  isBuffering: boolean = false;
  showWrongFeedback: boolean = false;
  
  private audio: HTMLAudioElement | null = null;
  private progressInterval: any;

  constructor(public songService: SongService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.gameStatus = 'loading';
    console.log('ngOnInit: starting initialization');
    
    // Inizializza il motore di ricerca online con RxJS
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(term => this.songService.searchAnime(term))
    ).subscribe(nomi => {
      // Includiamo anche i risultati locali per garantire che la risposta corretta sia trovabile
      const termLower = this.guess.trim().toLowerCase();
      let combined = new Set([
          ...this.allAnimeNames.filter(n => n.toLowerCase().includes(termLower)),
          ...nomi
      ]);
      
      this.filteredNames = Array.from(combined).sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aStarts = aLower.startsWith(termLower);
        const bStarts = bLower.startsWith(termLower);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aLower.localeCompare(bLower);
      }).slice(0, 15);
      
      this.cdr.detectChanges();
    });
    
    this.loadSongsForGame(this.mode);
  }

  setMode(newMode: 'random' | 'top' | 'seasonal'): void {
    if (this.mode === newMode) return;
    this.mode = newMode;
    this.restartGame();
  }

  restartGame(): void {
    this.stopAudio();
    this.gameStatus = 'loading';
    this.currentRound = 1;
    this.score = 0;
    this.cdr.detectChanges();
    this.loadSongsForGame(this.mode);
  }

  private loadSongsForGame(mode: 'random' | 'top' | 'seasonal'): void {
    this.songService.loadSongs(30, mode).subscribe({
      next: (success) => {
        console.log('loadSongs resolved with success =', success);
        if (!success || this.songService.errorMessage || !this.songService.isSongsReady()) {
          this.gameStatus = 'error';
          this.errorMessage = this.songService.errorMessage || `No songs found for ${mode} mode.`;
        } else {
          this.allAnimeNames = this.songService.getAllSongNames();
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
      this.loadSongsForGame(this.mode);
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
    
    if (this.currentSong) {
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
    }
  }

  onVolumeChange(): void {
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }

  getPlayDuration(): number {
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
    
    // Tenta di posizionare il cursore temporale (try...catch per precauzione se l'audio non è caricato)
    try {
      this.audio.currentTime = this.startOffset;
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
    
    if (this.guess.toLowerCase() === this.currentSong?.name.toLowerCase()) {
      this.guesses.push(this.guess);
      this.score++; // INCREMENT SCORE!
      this.gameStatus = 'won';
    } else {
      this.guesses.push(this.guess);
      this.triggerWrongFeedback();
      this.wrongGuessOrSkip();
    }
  }

  skip(): void {
    if (this.gameStatus !== 'playing') return;
    this.guesses.push('Skipped');
    this.wrongGuessOrSkip();
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
