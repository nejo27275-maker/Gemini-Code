'use strict';

const fs = require('fs');

class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.backupPath = configPath + '.bak';
    this.tmpPath = configPath + '.tmp';
  }

  // O config guarda a apiKey (em texto puro, se não houver passphrase): só o
  // dono lê. `mode` só vale na criação, por isso o chmod nos já existentes.
  _write(filePath, data) {
    fs.writeFileSync(filePath, data, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch (err) { /* Windows/FS sem permissões POSIX */ }
  }

  save(config) {
    const data = JSON.stringify(config, null, 2);
    this._write(this.tmpPath, data);
    fs.renameSync(this.tmpPath, this.configPath);
    this._write(this.backupPath, data);
    return config;
  }

  _tryReadJSON(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  _isValid(config) {
    return config !== null && typeof config === 'object' && !Array.isArray(config);
  }

  // Instalações antigas gravaram o config com 0644 (legível por outros usuários).
  _restringirPermissoes() {
    if (process.platform === 'win32') return;
    for (const p of [this.configPath, this.backupPath]) {
      try { if (fs.statSync(p).mode & 0o077) fs.chmodSync(p, 0o600); } catch (err) { /* não existe */ }
    }
  }

  load() {
    this._restringirPermissoes();
    const main = this._tryReadJSON(this.configPath);
    if (this._isValid(main)) return main;

    // Primeira execução (nem principal nem backup existem) não é corrupção:
    // não assusta o usuário com um aviso à toa.
    const primeiraExecucao = !fs.existsSync(this.configPath) && !fs.existsSync(this.backupPath);
    if (primeiraExecucao) return null;

    console.error('[config] Arquivo principal ausente ou corrompido. Tentando restaurar do backup...');

    const backup = this._tryReadJSON(this.backupPath);
    if (this._isValid(backup)) {
      try {
        const data = JSON.stringify(backup, null, 2);
        this._write(this.tmpPath, data);
        fs.renameSync(this.tmpPath, this.configPath);
        console.error('[config] Restaurado com sucesso a partir do backup.');
      } catch (err) {
        console.error('[config] Backup válido, mas falha ao restaurar o arquivo principal:', err.message);
      }
      return backup;
    }

    return null;
  }
}

module.exports = ConfigManager;
