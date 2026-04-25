import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap, timeout, forkJoin, switchMap } from 'rxjs';

export interface AnimeSong {
  id: string;
  name: string;
  url: string;
  songTitle?: string;
  artist?: string;
  imageUrl?: string;
  synonyms?: string[];
}

import { TOP_ANIME } from './top_anime';

@Injectable({
  providedIn: 'root'
})
export class SongService { private usedTopAnimes=new Set<string>();
  private usedAnilistAnimes=new Set<string>();
  private songs: AnimeSong[] = [];
  private unplayedSongs: AnimeSong[] = [];
  private isLoading = false;
  private isReady = false;
  
  public errorMessage: string = '';
  public userAnilist: {title: string, imageUrl: string}[] = [];
  public wrongAnswersPool: {title: string, imageUrl: string}[] = [];
  public seasonalWrongAnswersPool: {title: string, imageUrl: string}[] = [];

  constructor(private http: HttpClient) {
    this.ensureWrongAnswersPool('random');
  }

  public ensureWrongAnswersPool(mode: string) {
    if (mode === 'seasonal') {
       if (this.seasonalWrongAnswersPool.length > 30) return;
    } else {
       if (this.wrongAnswersPool.length > 150) return;
    }
    
    let query = ``;
    
    if (mode === 'seasonal') {
       const year = new Date().getFullYear();
       query = `
         query {
           Page(page: 1, perPage: 50) {
             media(type: ANIME, seasonYear: ${year}, sort: POPULARITY_DESC, isAdult: false) {
               title { romaji }
               coverImage { large medium }
             }
           }
         }
       `;
    } else {
       const page = Math.floor(Math.random() * 20) + 1;
       query = `
         query {
           Page(page: ${page}, perPage: 50) {
             media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
               title { romaji }
               coverImage { large medium }
             }
           }
         }
       `;
    }

    this.http.post<any>('https://graphql.anilist.co', { query }).subscribe({
      next: (res) => {
        if (res?.data?.Page?.media) {
           const fetched = res.data.Page.media.map((m: any) => ({
             title: m.title?.romaji || 'Unknown',
             imageUrl: m.coverImage?.large || m.coverImage?.medium || ''
           })).filter((m: any) => m.imageUrl);
           
           if (mode === 'seasonal') {
               const poolMap = new Map<string, string>();
               this.seasonalWrongAnswersPool.forEach(a => poolMap.set(a.title, a.imageUrl));
               fetched.forEach((a: any) => poolMap.set(a.title, a.imageUrl));
               this.seasonalWrongAnswersPool = Array.from(poolMap.entries()).map(([title, imageUrl]) => ({title, imageUrl})).sort(() => 0.5 - Math.random());
           } else {
               const poolMap = new Map<string, string>();
               this.wrongAnswersPool.forEach(a => poolMap.set(a.title, a.imageUrl));
               fetched.forEach((a: any) => poolMap.set(a.title, a.imageUrl));
               this.wrongAnswersPool = Array.from(poolMap.entries()).map(([title, imageUrl]) => ({title, imageUrl})).sort(() => 0.5 - Math.random());
           }
        }
      },
      error: (err) => console.error("Error preloading wrong answers pool", err)
    });
  }

  loadSongs(amount: number = 20, mode: 'random' | 'top' | 'seasonal' | 'anilist' = 'random', anilistUsername?: string): Observable<boolean> {
    this.isLoading = true;
    this.errorMessage = '';
    
    // Ricarichiamo il pool in background in modo da avere sempre nuove esche per i quiz
    this.ensureWrongAnswersPool(mode);

    if (mode === 'top') {
      return this.loadTopAnime();
    }
    
    if (mode === 'anilist' && anilistUsername) {
      return this.loadAnilistAnime(anilistUsername, amount);
    }

    let url = '';

    if (mode === 'seasonal') {
      const year = new Date().getFullYear();
      url = `https://api.animethemes.moe/anime?filter[year]=${year},${year-1}&sort=random&page[size]=${amount}&include=animethemes.animethemeentries.videos.audio,images,animethemes.song.artists,animesynonyms`;
    } else {
      url = `https://api.animethemes.moe/anime?sort=random&page[size]=${amount * 3}&include=animethemes.animethemeentries.videos.audio,images,animethemes.song.artists,animesynonyms`;
    }

    return this.executeDirectAnimeCall(url, amount);
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
                  const synonyms = animeData.animesynonyms?.map((s: any) => s.text) || [];

                  loaded.push({
                    id: theme.id.toString(),
                    name: name,
                    url: audioUrl,
                    songTitle: songTitle,
                    artist: artists,
                    imageUrl: largeCover?.link || '',
                    synonyms: synonyms
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
        const uniqueSet = new Set();
        const uniqueNameSet = new Set();
        this.songs = loadedSongs.filter(s => { 
          if(uniqueSet.has(s.url) || uniqueNameSet.has(s.name)){ 
            return false; 
          } 
          uniqueSet.add(s.url); 
          uniqueNameSet.add(s.name);
          return true; 
        });
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

    return this.loadSpecificAnimeList(randomTop, 'Top anime');
  }

  private loadAnilistAnime(username: string, amount: number): Observable<boolean> {
    const query = `
      query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME, status: COMPLETED) {
          lists {
            entries {
              media {
                title {
                  romaji
                }
                coverImage {
                  medium
                  large
                }
              }
            }
          }
        }
      }
    `;

    return this.http.post<any>('https://graphql.anilist.co', {
      query: query,
      variables: { userName: username }
    }).pipe(
      catchError(error => {
        console.error('Error fetching AniList', error);
        this.errorMessage = `Could not find AniList completions for user "${username}".`;
        return of(null);
      }),
      switchMap(response => {
        if (!response || !response.data || !response.data.MediaListCollection) {
           this.errorMessage = this.errorMessage || `No completed anime found for "${username}".`;
           this.isReady = true;
           this.isLoading = false;
           return of(false);
        }
        
        let userAnimeTitles: {title: string, imageUrl: string}[] = [];
        const lists = response.data.MediaListCollection.lists;
        if (lists && lists.length > 0) {
          lists.forEach((list: any) => {
            if (list.entries) {
              list.entries.forEach((entry: any) => {
                if (entry.media?.title?.romaji) {
                  userAnimeTitles.push({
                    title: entry.media.title.romaji,
                    imageUrl: entry.media.coverImage?.large || entry.media.coverImage?.medium || ''
                  });
                }
              });
            }
          });
        }

        if (userAnimeTitles.length === 0) {
           this.errorMessage = `No completed anime found for "${username}".`;
           this.isReady = true;
           this.isLoading = false;
           return of(false);
        }
        
        this.userAnilist = [...userAnimeTitles];
        
        let maxToLoad = Math.min(amount || 15, userAnimeTitles.length, 20); // max 20 per evitare timeout
        const randomPicks: string[] = [];
        
        let available = userAnimeTitles.filter(a => !this.usedAnilistAnimes.has(a.title));
        if (available.length < maxToLoad) {
           this.usedAnilistAnimes.clear();
           available = [...userAnimeTitles];
        }
        
        for (let i = 0; i < maxToLoad; i++) {
          if(available.length === 0) break;
          const idx = Math.floor(Math.random() * available.length);
          randomPicks.push(available[idx].title);
          this.usedAnilistAnimes.add(available[idx].title);
          available.splice(idx, 1);
        }
        
        console.log(`Chose ${randomPicks.length} random anime from ${username}'s list.`);
        return this.loadSpecificAnimeList(randomPicks, `${username}'s AniList`);
      })
    );
  }

  // Metodo helper generalizzato usato sia da TopAnime che da AniList Anime
  private loadSpecificAnimeList(animeNames: string[], listName: string): Observable<boolean> {
    const requests = animeNames.map(animeName => {
      const url = `https://api.animethemes.moe/anime?filter[name]=${encodeURIComponent(animeName)}&include=animethemes.animethemeentries.videos.audio,images,animethemes.song.artists,animesynonyms`;
      return this.http.get<any>(url).pipe(
        map(response => {
          const loaded: AnimeSong[] = [];
          if (response?.anime?.length > 0) {
            const animeData = response.anime[0];
            const name = animeData.name || 'Unknown Anime';
            const images = animeData.images || [];
            const largeCover = images.find((i: any) => i.facet === 'Large Cover') || images[0];

            if (animeData.animethemes) {
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
                  const synonyms = animeData.animesynonyms?.map((s: any) => s.text) || [];

                  loaded.push({
                    id: theme.id.toString(),
                    name: name,
                    url: audioUrl,
                    songTitle: songTitle,
                    artist: artists,
                    imageUrl: largeCover?.link || '',
                    synonyms: synonyms
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
        return results.reduce((acc, val) => acc.concat(val), []);
      }),
      tap((loadedSongs: AnimeSong[]) => {
        console.log(`Loaded ${loadedSongs.length} ${listName} opening songs.`);
        const uniqueSet = new Set();
        const uniqueNameSet = new Set();
        this.songs = loadedSongs.filter(s => { 
          if(uniqueSet.has(s.url) || uniqueNameSet.has(s.name)) { 
            return false; 
          } 
          uniqueSet.add(s.url); 
          uniqueNameSet.add(s.name);
          return true; 
        });
        this.unplayedSongs = [...this.songs];
        if (this.songs.length === 0) {
          this.errorMessage = `No songs found for the selected ${listName}. Please retry.`;
        }
        this.isReady = true;
        this.isLoading = false;
      }),
      map(loadedSongs => loadedSongs.length > 0),
      catchError(error => {
        console.error(`Error loading ${listName} themes`, error);
        this.errorMessage = error.message || `Failed to load ${listName} songs.`;
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

  getLocalAnimeData(): {name: string, synonyms: string[], imageUrl: string}[] {
    const list = this.songs.map(s => ({name: s.name, synonyms: s.synonyms || [], imageUrl: s.imageUrl || ''}));
    const unique = new Map();
    list.forEach(i => unique.set(i.name, i));
    return Array.from(unique.values()).sort((a,b) => a.name.localeCompare(b.name));
  }

  // Cerca anime online usando l'API GraphQL di AniList (più veloce ed affidabile di Jikan)
  searchAnime(term: string): Observable<{title: string, imageUrl: string}[]> {
    if (!term.trim()) return of([]);
    
    const query = `
      query ($search: String) {
        Page(page: 1, perPage: 15) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
            title {
              romaji
              english
            }
            coverImage {
              medium
            }
          }
        }
      }
    `;

    return this.http.post<any>('https://graphql.anilist.co', {
      query: query,
      variables: { search: term }
    }).pipe(
      map(res => {
        if (res && res.data && res.data.Page && res.data.Page.media) {
          return res.data.Page.media.map((a: any) => ({
            // AnimeThemes di solito usa i nomi romaji come titolo principale
            title: a.title?.romaji || a.title?.english || 'Unknown',
            imageUrl: a.coverImage?.medium || ''
          })) as {title: string, imageUrl: string}[];
        }
        return [];
      }),
      catchError(error => {
        console.error('Error during AniList search:', error);
        return of([]);
      })
    );
  }
}
