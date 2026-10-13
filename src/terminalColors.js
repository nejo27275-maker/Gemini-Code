'use strict';

// Pequeno adaptador de cores sem dependência externa. Mantém a interface usada
// pelo projeto (chalk.bold/dim/cyan/red/green/yellow) para o CLI funcionar
// também em ambientes offline, CI e Termux sem instalar uma biblioteca visual.
const colorCodes = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
};

const enabled = Boolean(
  process.stdout && process.stdout.isTTY &&
  !Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR') &&
  process.env.TERM !== 'dumb'
);

const colors = {};
for (const [name, [open, close]] of Object.entries(colorCodes)) {
  colors[name] = (value) => {
    const text = String(value);
    return enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  };
}

module.exports = colors;
