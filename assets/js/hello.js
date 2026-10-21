// A hello for anyone who opens the developer console.
(() => {
  const accent = 'color:#a34f3a;font:12px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace';
  const serif = 'color:#272724;font:15px/1.6 Georgia,"Times New Roman",serif';
  const quiet = 'color:#77756f;font:12px/1.6 system-ui,-apple-system,sans-serif';
  const logo = [
    '   _______',
    '  /      /|',
    ' /______/ |',
    ' | |\\ | | |',
    ' | | \\| | /',
    ' |______|/'
  ].join('\n');
  const cup = [
    '     ( (',
    '      ) )',
    '   ........',
    '   |      |]',
    '   \\      /',
    "    `----'"
  ].join('\n');
  const orders = ['a cortado', 'an oat flat white', 'a cold brew', 'a pour-over (give it a minute)', 'a double espresso', 'a cappuccino, extra foam'];

  console.log(`%c${logo}`, accent);
  console.log('%cHi, I’m Ganesh. Thanks for peeking under the hood.', serif);
  console.log('%cThe whole site is open source: https://github.com/njaladan/njaladan.github.io', quiet);
  console.log('%cpsst — type brew() for a coffee.', quiet);
  window.brew = () => {
    console.log(`%c${cup}`, accent);
    return `Here’s ${orders[Math.floor(Math.random() * orders.length)]}. ☕`;
  };
})();
