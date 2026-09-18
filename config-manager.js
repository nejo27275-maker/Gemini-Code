'use strict';

const fs = require('fs');

class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.backupPath = configPath + '.bak';
    this.tmpPath = configPath + '.tmp';
  }

  save(config) {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(this.tmpPath, data, 'utf8');
    fs.renameSync(this.tmpPath, this.configPath);
    fs.writeFileSync(this.backupPath, data, 'utf8');
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

  load() {
    const main = this._tryReadJSON(this.configPath);
    if (this._isValid(main)) return main;

    console.error('[config] Arquivo principal ausente ou corrompido. Tentando restaurar do backup...');

    const backup = this._tryReadJSON(this.backupPath);
    if (this._isValid(backup)) {
      try {
        const data = JSON.stringify(backup, null, 2);
        fs.writeFileSync(this.tmpPath, data, 'utf8');
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
