'use strict';
// adb FALSO compartilhado pelos testes (v0.44.1: saiu de tests/adbTools.test.js para as rotinas de TV usarem
// o mesmo). Imita o real onde importa para a segurança: em `adb shell a b c` ele JUNTA os argumentos com
// espaço, sem escapar (como o adb real e o ssh), e roda o resultado num /bin/sh cujo PATH só tem comandos
// falsos do "aparelho" (input, reboot, settings, pm, am...). Cada comando falso registra o que recebeu em
// DEVICE_LOG. Assim os testes veem exatamente o que a TV executaria — inclusive uma injeção.
const fs = require('fs');
const os = require('os');
const path = require('path');

function criarAdbFalso() {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-fake-'));
  const LOG = path.join(DIR, 'chamadas.log'); // argv que o adb recebeu nesta máquina
  const DEVICE_LOG = path.join(DIR, 'aparelho.log'); // comandos que o "aparelho" executou
  const STUBS = path.join(DIR, 'aparelho-bin');
  fs.mkdirSync(STUBS);

  const FAKE = path.join(DIR, 'adb-fake.js');
  fs.writeFileSync(FAKE, `
  const fs = require('fs');
  const cp = require('child_process');
  let a = process.argv.slice(2);
  fs.appendFileSync(process.env.ADB_LOG, JSON.stringify(a) + '\\n');
  if (process.env.ADB_MODE === 'fail') { process.stderr.write('device offline\\n'); process.exit(1); }
  if (a[0] === '-s') a = a.slice(2);
  if (a[0] === 'devices') { process.stdout.write('List of devices attached\\nABC123\\tdevice\\n'); process.exit(0); }
  if (a[0] === 'connect') { process.stdout.write('connected to ' + a[1] + '\\n'); process.exit(0); }
  if (a[0] === 'pair') { process.stdout.write(a[2] === '123456' ? 'Successfully paired to ' + a[1] + ' [guid=adb-X]\\n' : 'Failed: Wrong password or connection was dropped.\\n'); process.exit(0); }
  if (a[0] === 'mdns') { process.stdout.write('List of discovered mdns services\\nadb-SALA-abc\\t_adb-tls-pairing._tcp\\t192.168.0.50:37099\\nadb-SALA-abc\\t_adb-tls-connect._tcp\\t192.168.0.50:41235\\n'); process.exit(0); }
  if (a[0] === 'exec-out') { process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])); process.exit(0); }
  if (a[0] === 'shell') {
    const comando = a.slice(1).join(' '); // como o adb real: junta SEM escapar
    const r = cp.spawnSync('/bin/sh', ['-c', comando], { env: { PATH: process.env.ADB_STUBS, LOG: process.env.ADB_DEVICE_LOG }, encoding: 'utf8' });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    process.exit(r.status === null ? 1 : r.status);
  }
  process.stdout.write('ok\\n');
  `);
  const WRAP = path.join(DIR, 'adb');
  fs.writeFileSync(WRAP, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  fs.chmodSync(WRAP, 0o755);
  const WRAP_FALHA = path.join(DIR, 'adb-falha');
  fs.writeFileSync(WRAP_FALHA, `#!/bin/sh\nADB_MODE=fail exec "${process.execPath}" "${FAKE}" "$@"\n`);
  fs.chmodSync(WRAP_FALHA, 0o755);

  // Comandos falsos do aparelho: registram nome + argumentos (separados por TAB) e respondem o básico.
  const REGISTRA = 'printf \'%s\' "${0##*/}" >> "$LOG"; for x in "$@"; do printf \'\\t%s\' "$x" >> "$LOG"; done; printf \'\\n\' >> "$LOG"';
  const stubs = {
    input: '', reboot: '', settings: '', rm: '',
    am: 'case "$*" in *nao-abre*) printf \'Error: Activity not started, unable to resolve Intent\\n\';; start*) printf \'Starting: Intent { act=android.intent.action.VIEW }\\n\';; esac',
    getprop: 'printf \'[ro.product.brand]: [Sony]\\n[ro.product.model]: [BRAVIA]\\n[ro.build.version.release]: [11]\\n[ro.build.version.sdk]: [30]\\n[ro.build.characteristics]: [tv]\\n\'',
    pm: 'if [ "$1" = list ]; then printf \'package:com.spotify.tv.android\\npackage:com.netflix.ninja\\n\'; fi',
    monkey: 'if [ "$2" = com.nao.existe ]; then printf \'** No activities found to run, monkey aborted.\\n\'; else printf \'Events injected: 1\\n\'; fi',
    dumpsys: 'printf \'  mResumedActivity: ActivityRecord{1a2b u0 com.netflix.ninja/.MainActivity t12}\\n\'',
  };
  for (const [nome, resposta] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(STUBS, nome), `#!/bin/sh\n${REGISTRA}\n${resposta}\n`);
    fs.chmodSync(path.join(STUBS, nome), 0o755);
  }
  process.env.ADB_LOG = LOG;
  process.env.ADB_DEVICE_LOG = DEVICE_LOG;
  process.env.ADB_STUBS = STUBS;

  const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean) : []);
  return {
    DIR, FAKE, WRAP, WRAP_FALHA, LOG, DEVICE_LOG,
    /** argv que o adb recebeu nesta máquina */
    chamadas: () => ler(LOG).map((l) => JSON.parse(l)),
    /** comandos que o "aparelho" executou: [nome, ...argumentos] */
    noAparelho: () => ler(DEVICE_LOG).map((l) => l.split('\t')),
    limpar: () => { fs.writeFileSync(LOG, ''); fs.writeFileSync(DEVICE_LOG, ''); },
    /** variáveis para um processo filho (CLI) usar o mesmo adb falso */
    env: { ADB_LOG: LOG, ADB_DEVICE_LOG: DEVICE_LOG, ADB_STUBS: STUBS },
  };
}

module.exports = { criarAdbFalso };
