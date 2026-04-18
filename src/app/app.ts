import { Component } from '@angular/core';
import { Game } from './components/game/game';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Game],
  template: '<app-game></app-game>'
})
export class App {}
