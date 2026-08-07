import kleur from 'kleur';

export const log = {
  info: (msg: string) => console.log(msg),
  step: (msg: string) => console.log(kleur.cyan(`▸ ${msg}`)),
  success: (msg: string) => console.log(kleur.green(`✓ ${msg}`)),
  warn: (msg: string) => console.log(kleur.yellow(`! ${msg}`)),
  error: (msg: string) => console.error(kleur.red(`✗ ${msg}`)),
  dim: (msg: string) => console.log(kleur.gray(msg)),
};
