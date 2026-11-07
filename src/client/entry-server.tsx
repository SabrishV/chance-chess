// Used at build time to pre-render the home page into index.html for search engines.
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { FAQ } from './content';

export function render(): string {
  return renderToString(<App />);
}

export { FAQ };
