import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap, timeout, forkJoin } from 'rxjs';

export interface AnimeSong {
  id: string;
  name: string;
  url: string;
  songTitle?: string;
  artist?: string;
  imageUrl?: string;
}

import { TOP_ANIME } from './top_anime';

@Injectable({
  providedIn: 'root'
})
export class SongService { private usedTopAnimes=new Set<string>();
  private songs: AnimeSong[] = [];
  private unplayedSongs: AnimeSong[] = [];
  private isLoading = false;
  private isReady = false;
  
  public errorMessage: string = '';

  constructor(private http: HttpClient) {}

  loadSongs(amount: number = 20, mode: 'random' | 'top' | 'seasonal' = 'random'): Observable<boolean> {
    this.isLoading = true;
    this.errorMessage = '';

    if (mode === 'top') {
      return this.loadTopAnime();
    }

    let url = `https://api.animethemes.moe/animetheme?page[size]=${amount * 2}&filter[type]=OP&include=anime,anime.images,song,song.artists,animethemeentries.videos.audio`;
    
    if (mode === 'seasonal') {
      const year = new Date().getFullYear();
      url = `https://api.animethemes.moe/anime?filter[year]=${year},${year-1}&sort=random&page[size]=${amount}&include=animethemes.animethemeentries.videos.audio,images,animethemes.song.artists`;
      return this.executeDirectAnimeCall(url, amount);
    } else {
      url += `&sort=random`;
    }

    console.log('Fetching from:', url);

    return this.http.get<any>(url)
      .pipe(
        timeout(10000),
        map(response => {
          const loadedSongs: AnimeSong[] = [];
          if (response?.animethemes) {
            for (const theme of response.animethemes) {
              let audioUrl = '';
              const animeName = theme.anime?.name || 'Unknown Anime';

              if (theme.animethemeentries?.length > 0) {
                const entry = theme.animethemeentries[0];
                if (entry.videos?.length > 0) {
                    const video = entry.videos[0];
                    // USE .ogg AUDIO FOR ZERO DELAY AND -90% BANDWIDTH
                    audioUrl = video.audio?.link || video.link;
                }
              }

              if (audioUrl) {
                // Get additional rich data for end card
                const images = theme.anime?.images || [];
                const largeCover = images.find((i: any) => i.facet === 'Large Cover') || images[0];
                const songTitle = theme.song?.title || 'Unknown Title';
                const artists = theme.song?.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist';

                loadedSongs.push({
                  id: theme.id.toString(),
                  name: animeName,
                  url: audioUrl,
                  songTitle: songTitle,
                  artist: artists,
                  imageUrl: largeCover?.link || ''
                });
              }
            }
          }
          return loadedSongs;
        }),
        tap(loadedSongs => {
          console.log(`Loaded ${loadedSongs.length} Opening songs.`);
          const uniqueSet = new Set(); this.songs = loadedSongs.filter(s => { if(uniqueSet.has(s.url)){ return false; } uniqueSet.add(s.url); return true; });
          this.unplayedSongs = [...this.songs];
          this.isReady = true;
          this.isLoading = false;
        }),
        map(loadedSongs => loadedSongs.length > 0),
        catchError(error => {
          console.error('Error loading anime themes', error);
          this.errorMessage = error.message || 'Failed to load songs.';
          this.isLoading = false;
          return of(false);
        })
      );
  }

  private executeDirectAnimeCall(url: string, amount: number): Observable<boolean> {
    console.log('Fetching current/recent seasonal from:', url);
    return this.http.get<any>(url).pipe(
      timeout(10000),
      map(response => {
        const loaded: AnimeSong[] = [];
        if (response?.anime) {
          for (const animeData of response.anime) {
            const name = animeData.name || 'Unknown Anime';
            const images = animeData.images || [];
            const largeCover = images.find((i: any) => i.facet === 'Large Cover') || images[0];

            if (animeData.animethemes) {
              // Extract only OPs, shuffle them, and pick only 1 random opening per anime to prevent monopoly
              let opThemes = animeData.animethemes.filter((t: any) => t.type === 'OP');
              
              const uniqueThemes = [];
              const seenTitles = new Set();
              for (const t of opThemes) {
                const title = t.song?.title?.toLowerCase() || t.id;
                if (!seenTitles.has(title)) {
                  seenTitles.add(title);
                  uniqueThemes.push(t);
                }
              }
              opThemes = uniqueThemes.sort(() => 0.5 - Math.random()).slice(0, 1);

              for (const theme of opThemes) {
                let audioUrl = '';
                if (theme.animethemeentries?.length > 0) {
                  const entry = theme.animethemeentries[0];
                  if (entry.videos?.length > 0) {
                      const video = entry.videos[0];
                      audioUrl = video.audio?.link || video.link;
                  }
                }

                if (audioUrl) {
                  const songTitle = theme.song?.title || 'Unknown Title';
                  const artists = theme.song?.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist';

                  loaded.push({
                    id: theme.id.toString(),
                    name: name,
                    url: audioUrl,
                    songTitle: songTitle,
                    artist: artists,
                    imageUrl: largeCover?.link || ''
                  });
                }
              }
            }
          }
        }
        return loaded;
      }),
      tap((loadedSongs: AnimeSong[]) => {
        console.log(`Loaded ${loadedSongs.length} Seasonal opening songs.`);
        const uniqueSet = new Set(); this.songs = loadedSongs.filter(s => { if(uniqueSet.has(s.url)){ return false; } uniqueSet.add(s.url); return true; });
        this.unplayedSongs = [...this.songs];
        if (this.songs.length === 0) {
          this.errorMessage = 'No songs found for the selected mode. Please retry.';
        }
        this.isReady = true;
        this.isLoading = false;
      }),
      map(loadedSongs => loadedSongs.length > 0),
      catchError(error => {
        console.error('Error loading anime themes', error);
        this.errorMessage = error.message || 'Failed to load songs.';
        this.isLoading = false;
        return of(false);
      })
    );
  }

  private loadTopAnime(): Observable<boolean> {
    const randomTop: string[] = [];
    let topAnimeCopy = TOP_ANIME.filter(a => !this.usedTopAnimes.has(a));
    if (topAnimeCopy.length < 15) {
      this.usedTopAnimes.clear();
      topAnimeCopy = [...TOP_ANIME];
    }
    for (let i = 0; i < 15; i++) { // Extract 15 random top anime
        const idx = Math.floor(Math.random() * topAnimeCopy.length);
        const a = topAnimeCopy[idx];
        randomTop.push(a);
        this.usedTopAnimes.add(a);
        topAnimeCopy.splice(idx, 1);
    }

    const requests = randomTop.map(animeName => {
      const url = `https://api.animethemes.moe/anime?filter[name]=${encodeURIComponent(animeName)}&include=animethemes.animethemeentries.videos.audio,images,animethemes.song.artists`;
      return this.http.get<any>(url).pipe(
        map(response => {
          const loaded: AnimeSong[] = [];
          if (response?.anime?.length > 0) {
            const animeData = response.anime[0];
            const name = animeData.name || 'Unknown Anime';
            const images = animeData.images || [];
            const largeCover = images.find((i: any) => i.facet === 'Large Cover') || images[0];

            if (animeData.animethemes) {
              // Extract only OPs, shuffle them, and pick only 1 random opening per anime to prevent monopoly
              let opThemes = animeData.animethemes.filter((t: any) => t.type === 'OP');
              
              const uniqueThemes = [];
              const seenTitles = new Set();
              for (const t of opThemes) {
                const title = t.song?.title?.toLowerCase() || t.id;
                if (!seenTitles.has(title)) {
                  seenTitles.add(title);
                  uniqueThemes.push(t);
                }
              }
              opThemes = uniqueThemes.sort(() => 0.5 - Math.random()).slice(0, 1);

              for (const theme of opThemes) {
                let audioUrl = '';
                if (theme.animethemeentries?.length > 0) {
                  const entry = theme.animethemeentries[0];
                  if (entry.videos?.length > 0) {
                      const video = entry.videos[0];
                      audioUrl = video.audio?.link || video.link;
                  }
                }

                if (audioUrl) {
                  const songTitle = theme.song?.title || 'Unknown Title';
                  const artists = theme.song?.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist';

                  loaded.push({
                    id: theme.id.toString(),
                    name: name,
                    url: audioUrl,
                    songTitle: songTitle,
                    artist: artists,
                    imageUrl: largeCover?.link || ''
                  });
                }
              }
            }
          }
          return loaded;
        }),
        catchError(() => of([]))
      );
    });

    return forkJoin(requests).pipe(
      timeout(15000),
      map((results: AnimeSong[][]) => {
        // Flatten the array of arrays
        return results.reduce((acc, val) => acc.concat(val), []);
      }),
      tap((loadedSongs: AnimeSong[]) => {
        console.log(`Loaded ${loadedSongs.length} Top anime opening songs.`);
        const uniqueSet = new Set(); this.songs = loadedSongs.filter(s => { if(uniqueSet.has(s.url)){ return false; } uniqueSet.add(s.url); return true; });
        this.unplayedSongs = [...this.songs];
        if (this.songs.length === 0) {
          this.errorMessage = 'No songs found for the selected Top Anime. Please retry.';
        }
        this.isReady = true;
        this.isLoading = false;
      }),
      map(loadedSongs => loadedSongs.length > 0),
      catchError(error => {
        console.error('Error loading top anime themes', error);
        this.errorMessage = error.message || 'Failed to load Top Anime songs.';
        this.isLoading = false;
        return of(false);
      })
    );
  }

  isSongsReady(): boolean {
    return this.isReady && this.songs.length > 0;
  }

  isSongsExhausted(): boolean {
    return this.isReady && this.songs.length > 0 && this.unplayedSongs.length === 0;
  }

  getRandomSong(): AnimeSong | null {
    if (!this.isSongsReady() || this.isSongsExhausted()) return null;
    
    // Pesca casualmente dal mazzo delle non-ancora-giocate (metodo Bag/Mazzo)
    const randomIndex = Math.floor(Math.random() * this.unplayedSongs.length);
    const selected = this.unplayedSongs[randomIndex];
    
    // Rimuovi la canzone dal mazzo per non ripeterla
    this.unplayedSongs.splice(randomIndex, 1);
    
    return selected;
  }

  getAllSongNames(): string[] {
    return Array.from(new Set(this.songs.map(s => s.name))).sort();
  }

  // Cerca un anime online tramite AnimeThemes API
  searchAnime(term: string): Observable<string[]> {
    if (!term.trim()) return of([]);
    const url = `https://api.animethemes.moe/anime?q=${encodeURIComponent(term)}&page[size]=15`;
    return this.http.get<any>(url).pipe(
      map(res => {
        if (res && res.anime) {
          return res.anime.map((a: any) => a.name) as string[];
        }
        return [];
      }),
      catchError(() => of([]))
    );
  }
}
