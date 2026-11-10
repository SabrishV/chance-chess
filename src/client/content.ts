// Page copy shared by the home page and the build-time pre-render (FAQ structured data).

import type { GameMode } from '../engine';

export const MODES: Record<GameMode, { label: string; blurb: string; rules: string }> = {
  capture: {
    label: 'Capture the king',
    blurb: 'The original. No checkmate: take the enemy king to win. Leave yours exposed and one lucky card can finish you.',
    rules:
      'There is no check or checkmate. You may leave your king under attack, and the game ends the moment a king is captured. With the cards, every threat is real: a Double Move or a Teleport can strike from nowhere.',
  },
  checkmate: {
    label: 'Checkmate',
    blurb: 'Real chess rules: no moving into check, win by checkmate. A lucky last-chance card can still save a lost king.',
    rules:
      "You can't move, teleport or swap into check, and you win by checkmate. Checkmate is decided after the draw: when no normal move can save your king, you get one last-chance draw, and only a Teleport can rescue it.",
  },
  hand: {
    label: 'Card hand',
    blurb: 'Keep up to 3 power cards and play them when it suits you. Real chess rules: win by checkmate.',
    rules:
      "Checkmate rules, plus a hand of cards. Draw a Double Move, Wild or Teleport and you can keep it for later (up to 3 cards) and make a normal move instead. On a later turn, play a kept card in place of the one you drew: a kept Teleport can even rescue a king that's about to be mated. Both hands are on show, and Skip and Undo still hit you straight away.",
  },
};

export const AUTHOR = { name: 'Sabrish Varadharajan', url: 'https://sabrish.vercel.app/' };

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Chance Chess?',
    a: 'Chance Chess is a chess variant that mixes classic chess strategy with a deck of cards. Before every turn you draw a card: most let you move normally, but some give you a double move, teleport a piece, or bring back a captured piece on your side, while cursed cards make you skip a turn or take back your last move.',
  },
  {
    q: 'How do you win a game of Chance Chess?',
    a: "In the classic mode, by capturing the enemy king: there is no checkmate, so you may leave your king under attack, but a lucky card for your opponent can end the game on the spot. In Checkmate mode you win by checkmate, with real chess rules, though a lucky last-chance card can still save a lost king. Card hand mode also plays to checkmate, and lets you keep power cards to play when you choose.",
  },
  {
    q: 'Can I play Chance Chess with friends online?',
    a: 'Yes. Create an online game, send the invite link to a friend, and the game starts as soon as they open it. No account or download needed.',
  },
  {
    q: 'Can I play against the computer?',
    a: 'Yes. The computer opponent has three levels (Easy, Medium and Hard) and plays every card, including teleports and wild swaps.',
  },
  {
    q: 'Is Chance Chess free?',
    a: 'Yes, it is free to play in any modern browser, on desktop or mobile.',
  },
];
