// Page copy shared by the home page and the build-time pre-render (FAQ structured data).

export const AUTHOR = { name: 'Sabrish Varadharajan', url: 'https://sabrish.vercel.app/' };

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Chance Chess?',
    a: 'Chance Chess is a chess variant that mixes classic chess strategy with a deck of cards. Before every turn you draw a card: most let you move normally, but some give you a double move, teleport a piece, or bring back a captured piece on your side, while cursed cards make you skip a turn or take back your last move.',
  },
  {
    q: 'How do you win a game of Chance Chess?',
    a: "By capturing the enemy king. There is no checkmate, so you're allowed to leave your king under attack, but a lucky card for your opponent (or an unlucky one for you) can end the game on the spot.",
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
