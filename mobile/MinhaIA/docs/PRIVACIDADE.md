# Privacidade e segurança

- O aplicativo não declara permissão de internet nem usa analytics/anúncios neste código.
- Conversas, perfil, memórias, trechos de documentos e modelos são armazenados no armazenamento privado do app.
- Memórias são adicionadas por ação explícita do usuário e podem ser excluídas individualmente ou por completo.
- Importação de TXT tem limite de 1.000.000 caracteres; backups têm limite de 12.000.000 caracteres, limites de quantidade e validação do campo `schema`.
- Conteúdo dos arquivos é tratado como dado não confiável e recebe delimitadores no prompt. Nenhuma barreira de prompt é perfeita; revise respostas e não importe dados secretos desnecessários.
- Backup JSON não é criptografado. Armazene e compartilhe com cuidado.
- A cópia de um modelo ocupa espaço adicional no armazenamento privado. O código não exclui arquivos do usuário fora do sandbox do app.
- O uso de armazenamento e RAM depende do modelo importado. O app não realiza teste de temperatura nem promete evitar aquecimento.
- Apagar mensagens não apaga automaticamente memórias nem documentos; essas categorias possuem controles separados.
