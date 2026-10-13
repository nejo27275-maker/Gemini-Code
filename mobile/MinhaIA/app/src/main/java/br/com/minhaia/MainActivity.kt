package br.com.minhaia

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.StatFs
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.arm.aichat.AiChat
import com.arm.aichat.InferenceEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var store: ChatStore
    private lateinit var profileStore: ProfileStore
    private lateinit var scope: CoroutineScope
    private var engine: InferenceEngine? = null
    private val uiMessages = mutableStateListOf<ChatMessage>()
    private var profile by mutableStateOf(AiProfile())
    private var status by mutableStateOf("Preparando motor local…")
    private var modelLabel by mutableStateOf("Nenhum modelo carregado")
    private var deviceInfo by mutableStateOf("Lendo recursos do aparelho…")
    private var modelReady by mutableStateOf(false)
    private var loadingModel by mutableStateOf(false)
    private var generating by mutableStateOf(false)
    private var showSettings by mutableStateOf(false)
    private var showModels by mutableStateOf(false)
    private var installedModels by mutableStateOf(emptyList<File>())
    private var showMemories by mutableStateOf(false)
    private var memories by mutableStateOf(emptyList<SavedMemory>())
    private var localDocs by mutableStateOf(emptyList<LocalDocument>())
    private var generationJob: Job? = null

    private val modelPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importModel(uri)
    }
    private val textPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importTextDocument(uri)
    }
    private val backupPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importBackup(uri)
    }
    private val backupExporter = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) exportBackup(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ChatStore(applicationContext)
        profileStore = ProfileStore(applicationContext)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        profile = profileStore.load()
        deviceInfo = readDeviceInfo()
        uiMessages.clear()
        uiMessages.addAll(store.allMessages())
        refreshLocalLists()

        setContent {
            MaterialTheme {
                MinhaIaScreen(
                    name = profile.name,
                    status = status,
                    modelLabel = modelLabel,
                    modelReady = modelReady,
                    loadingModel = loadingModel,
                    generating = generating,
                    messages = uiMessages,
                    welcome = profile.welcome,
                    onSend = ::sendMessage,
                    onSelectModel = { refreshInstalledModels(); showModels = true },
                    onImportText = { textPicker.launch(arrayOf("text/plain", "text/*", "application/octet-stream")) },
                    onOpenSettings = { showSettings = true },
                    onOpenMemories = { refreshLocalLists(); showMemories = true },
                    onCancelGeneration = ::cancelGeneration
                )
                if (showModels) {
                    ModelsDialog(
                        models = installedModels,
                        activePath = profileStore.modelPath,
                        deviceInfo = deviceInfo,
                        onDismiss = { showModels = false },
                        onImport = { showModels = false; modelPicker.launch(arrayOf("*/*")) },
                        onChoose = { file ->
                            showModels = false
                            scope.launch {
                                try { loadModel(file) } catch (_: Exception) { /* status already explains the problem */ }
                            }
                        }
                    )
                }
                if (showSettings) {
                    ProfileDialog(
                        initial = profile,
                        onDismiss = { showSettings = false },
                        onSave = { updated ->
                            profile = updated
                            profileStore.save(updated)
                            showSettings = false
                            status = "Perfil salvo neste aparelho. As instruções personalizam o uso, não treinam os pesos."
                        },
                        onClearHistory = {
                            store.clearMessages(); uiMessages.clear(); status = "Histórico apagado."
                        },
                        onClearMemories = {
                            store.clearMemories(); refreshLocalLists(); status = "Memórias apagadas."
                        },
                        onExport = { backupExporter.launch("minhaia-backup.json") },
                        onImport = { backupPicker.launch(arrayOf("application/json", "text/*", "*/*")) }
                    )
                }
                if (showMemories) {
                    MemoriesDialog(
                        memories = memories,
                        onDismiss = { showMemories = false },
                        onAdd = { text ->
                            try {
                                store.addMemory(text)
                                refreshLocalLists()
                                status = "Memória salva localmente."
                            } catch (e: Exception) { status = e.message ?: "Não foi possível salvar a memória." }
                        },
                        onDelete = { id -> store.deleteMemory(id); refreshLocalLists() },
                        documents = localDocs
                    )
                }
            }
        }
        initializeEngine()
    }

    private fun initializeEngine() {
        scope.launch {
            try {
                val loaded = withContext(Dispatchers.IO) { AiChat.getInferenceEngine(applicationContext) }
                val initializationState = withContext(Dispatchers.IO) {
                    loaded.state.first {
                        it is InferenceEngine.State.Initialized ||
                            it is InferenceEngine.State.ModelReady ||
                            it is InferenceEngine.State.Error
                    }
                }
                if (initializationState is InferenceEngine.State.Error) throw initializationState.exception
                engine = loaded
                if (initializationState is InferenceEngine.State.ModelReady) {
                    val activeFile = profileStore.modelPath?.let(::File)
                    modelLabel = activeFile?.takeIf { it.isFile }?.let { "${it.name} · ${"%.2f".format(it.length() / 1_000_000_000.0)} GB" } ?: "Modelo já carregado"
                    modelReady = true
                    status = "Motor e modelo local já estão prontos."
                } else {
                    status = "Motor local inicializado. Nenhuma conexão é necessária para inferência."
                    val previous = profileStore.modelPath?.let(::File)
                    if (previous != null && previous.isFile && previous.length() > 0) {
                        loadModel(previous)
                    } else {
                        status = "Motor pronto. Importe um arquivo GGUF compatível para começar."
                    }
                }
            } catch (e: UnsatisfiedLinkError) {
                status = "A biblioteca nativa não carregou: ${e.message ?: e.javaClass.simpleName}. Recompile o app com ARM64, NDK e CMake compatíveis."
            } catch (e: Exception) {
                status = "Falha ao iniciar o motor nativo: ${e.message ?: e.javaClass.simpleName}. Refaça a preparação do projeto e compile com NDK/CMake compatíveis."
            }
        }
    }

    private fun readDeviceInfo(): String {
        val memory = ActivityManager.MemoryInfo()
        (getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(memory)
        fun gib(bytes: Long): String = String.format(Locale.getDefault(), "%.1f", bytes / 1_073_741_824.0)
        val total = if (memory.totalMem > 0L) "${gib(memory.totalMem)} GB" else "indisponível"
        val available = if (memory.availMem > 0L) "${gib(memory.availMem)} GB" else "indisponível"
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "desconhecida"
        return "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ABI $abi · RAM total $total · disponível agora $available. A RAM livre varia e não garante que um modelo caiba."
    }

    private fun importModel(uri: Uri) {
        if (loadingModel || generating) return
        scope.launch {
            loadingModel = true
            modelReady = false
            status = "Validando e copiando o arquivo GGUF para o armazenamento privado…"
            try {
                val target = withContext(Dispatchers.IO) { copyAndValidateModel(uri) }
                loadModel(target)
            } catch (e: Exception) {
                status = "Não foi possível importar o modelo: ${e.message ?: e.javaClass.simpleName}"
                toast(status)
            } finally { loadingModel = false }
        }
    }

    @Throws(IOException::class)
    private fun copyAndValidateModel(uri: Uri): File {
        val dir = File(filesDir, "models")
        if (!dir.exists() && !dir.mkdirs()) throw IOException("Não foi possível criar a pasta de modelos.")
        val display = queryDisplayName(uri) ?: "modelo.gguf"
        val safeName = display.replace(Regex("[^A-Za-z0-9._() -]"), "_").take(120)
        val finalName = if (safeName.lowercase().endsWith(".gguf")) safeName else "$safeName.gguf"
        val temp = File.createTempFile("import-", ".part", dir)
        try {
            val available = StatFs(filesDir.absolutePath).availableBytes
            val declaredSize = querySize(uri)
            val required = if (declaredSize != null && declaredSize > 0L) declaredSize + 256_000_000L else 1_500_000_000L
            if (available < required) throw IOException("Pouco espaço livre. Precisa de aproximadamente ${required / 1_000_000_000.0} GB disponíveis para copiar o modelo com segurança.")
            val input = contentResolver.openInputStream(uri) ?: throw IOException("O Android não conseguiu abrir esse arquivo.")
            var total = 0L
            input.use { source ->
                temp.outputStream().buffered().use { dest ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > 8_000_000_000L) throw IOException("Arquivo maior que o limite de segurança de 8 GB.")
                        dest.write(buffer, 0, count)
                    }
                }
            }
            if (total < 4) throw IOException("Arquivo vazio ou incompleto.")
            val magic = temp.inputStream().use { byteArrayOf(it.read().toByte(), it.read().toByte(), it.read().toByte(), it.read().toByte()) }
            if (!magic.contentEquals(byteArrayOf('G'.code.toByte(), 'G'.code.toByte(), 'U'.code.toByte(), 'F'.code.toByte()))) {
                throw IOException("O cabeçalho do arquivo não é GGUF. Escolha um modelo compatível.")
            }
            val target = File(dir, finalName)
            if (target.exists() && !target.delete()) throw IOException("Não foi possível substituir o arquivo de mesmo nome.")
            if (!temp.renameTo(target)) throw IOException("Não foi possível finalizar a cópia do modelo.")
            return target
        } catch (e: Exception) {
            temp.delete()
            throw e
        }
    }

    private suspend fun loadModel(file: File) {
        val loaded = engine ?: throw IllegalStateException("Motor de inferência ainda não inicializado.")
        loadingModel = true
        modelReady = false
        status = "Carregando ${file.name}. Modelos grandes podem demorar e aquecer o aparelho."
        try {
            val currentState = loaded.state.value
            if (currentState is InferenceEngine.State.ModelReady ||
                currentState is InferenceEngine.State.Generating ||
                currentState is InferenceEngine.State.ProcessingSystemPrompt ||
                currentState is InferenceEngine.State.ProcessingUserPrompt ||
                currentState is InferenceEngine.State.Error) {
                loaded.cleanUp()
                val readyState = withContext(Dispatchers.IO) {
                    loaded.state.first { it is InferenceEngine.State.Initialized || it is InferenceEngine.State.Error }
                }
                if (readyState is InferenceEngine.State.Error) throw readyState.exception
            }
            withContext(Dispatchers.IO) { loaded.loadModel(file.absolutePath) }
            profileStore.modelPath = file.absolutePath
            modelLabel = "${file.name} · ${"%.2f".format(file.length() / 1_000_000_000.0)} GB"
            modelReady = true
            status = "Modelo carregado. Chat executado localmente; teste também em modo avião."
        } catch (e: Exception) {
            profileStore.modelPath = null
            modelLabel = "Nenhum modelo carregado"
            status = "O modelo não pôde ser carregado (arquitetura não suportada, arquivo incompleto ou RAM insuficiente): ${e.message ?: e.javaClass.simpleName}"
            throw e
        } finally { loadingModel = false }
    }

    private fun sendMessage(text: String) {
        val userText = text.trim()
        if (userText.isEmpty() || generating) return
        val activeEngine = engine
        if (!modelReady || activeEngine == null) {
            status = "Antes de conversar, toque em ‘Modelo’ e selecione um GGUF compatível."
            return
        }
        val previous = store.recentMessages(8)
        val matchingMemories = store.relevantMemories(userText, 4)
        val matchingDocuments = store.relevantDocumentSnippets(userText, 3)
        store.addMessage("user", userText)
        uiMessages.add(ChatMessage(-System.currentTimeMillis(), "user", userText, System.currentTimeMillis()))
        val assistantTimestamp = System.currentTimeMillis() + 1
        uiMessages.add(ChatMessage(-assistantTimestamp, "assistant", "", assistantTimestamp))
        generating = true
        status = "Gerando no aparelho…"
        var answer = StringBuilder()
        generationJob = scope.launch {
            try {
                val systemPrompt = PromptComposer.build(profile, previous, matchingMemories, matchingDocuments)
                withContext(Dispatchers.IO) { activeEngine.setSystemPrompt(systemPrompt) }
                activeEngine.sendUserPrompt(userText, profile.maxTokens).collect { token ->
                    answer.append(token)
                    val last = uiMessages.lastIndex
                    if (last >= 0) uiMessages[last] = uiMessages[last].copy(content = answer.toString())
                }
                status = if (answer.isNotBlank()) "Resposta concluída localmente." else "A geração terminou sem texto. Verifique o modelo e o template de chat."
            } catch (cancelled: CancellationException) {
                status = "Geração interrompida."
                throw cancelled
            } catch (e: Exception) {
                status = "Erro durante a inferência: ${e.message ?: e.javaClass.simpleName}"
                if (answer.isBlank()) {
                    val last = uiMessages.lastIndex
                    if (last >= 0) uiMessages[last] = uiMessages[last].copy(content = "Não consegui gerar a resposta. Confira o arquivo do modelo e a memória disponível.")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.IO) {
                    if (answer.isNotBlank()) store.addMessage("assistant", answer.toString())
                }
                generating = false
                generationJob = null
            }
        }
    }

    private fun cancelGeneration() {
        generationJob?.cancel(CancellationException("Interrompido pelo usuário"))
        status = "Solicitando interrupção da geração…"
    }

    private fun importTextDocument(uri: Uri) {
        scope.launch {
            try {
                val name = queryDisplayName(uri) ?: "documento.txt"
                if (!name.lowercase().endsWith(".txt")) throw IOException("Nesta versão, importe apenas arquivos .txt.")
                val content = withContext(Dispatchers.IO) { readTextLimited(uri, ChatStore.MAX_DOCUMENT_CHARS) }
                store.addDocument(name, content)
                refreshLocalLists()
                status = "Documento guardado localmente. Trechos relevantes podem ser usados no chat."
            } catch (e: Exception) { status = "Falha ao importar TXT: ${e.message ?: e.javaClass.simpleName}" }
        }
    }

    private fun exportBackup(uri: Uri) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(store.exportBackup()) }
                        ?: throw IOException("Não foi possível escrever o arquivo de backup.")
                }
                status = "Backup JSON exportado. Guarde-o em local seguro."
            } catch (e: Exception) { status = "Falha ao exportar: ${e.message ?: e.javaClass.simpleName}" }
        }
    }

    private fun importBackup(uri: Uri) {
        scope.launch {
            try {
                val json = withContext(Dispatchers.IO) { readTextLimited(uri, ChatStore.MAX_BACKUP_CHARS) }
                store.importBackup(json)
                uiMessages.clear(); uiMessages.addAll(store.allMessages())
                refreshLocalLists()
                status = "Backup importado para o banco local. Verifique o conteúdo antes de confiar nele."
            } catch (e: Exception) { status = "Backup recusado: ${e.message ?: e.javaClass.simpleName}" }
        }
    }

    private fun refreshLocalLists() {
        memories = store.memories()
        localDocs = store.documents().map { it.copy(content = "") }
    }

    private fun refreshInstalledModels() {
        val dir = File(filesDir, "models")
        installedModels = dir.listFiles()?.filter { it.isFile && it.extension.equals("gguf", ignoreCase = true) }?.sortedBy { it.name } ?: emptyList()
    }

    private fun readTextLimited(uri: Uri, maximumCharacters: Int): String {
        val input = contentResolver.openInputStream(uri) ?: throw IOException("O Android não conseguiu abrir esse arquivo.")
        val result = StringBuilder()
        input.bufferedReader(Charsets.UTF_8).use { reader ->
            val buffer = CharArray(8192)
            while (true) {
                val count = reader.read(buffer)
                if (count < 0) break
                if (result.length + count > maximumCharacters) throw IOException("O arquivo ultrapassa o limite de ${maximumCharacters} caracteres.")
                result.append(buffer, 0, count)
            }
        }
        return result.toString()
    }

    private fun querySize(uri: Uri): Long? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
        }
    } catch (_: Exception) { null }

    private fun queryDisplayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (_: Exception) { null }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        // The process-scoped native singleton is left for OS cleanup to avoid freeing JNI state mid-generation.
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MinhaIaScreen(
    name: String,
    status: String,
    modelLabel: String,
    modelReady: Boolean,
    loadingModel: Boolean,
    generating: Boolean,
    messages: List<ChatMessage>,
    welcome: String,
    onSend: (String) -> Unit,
    onSelectModel: () -> Unit,
    onImportText: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenMemories: () -> Unit,
    onCancelGeneration: () -> Unit
) {
    var input by androidx.compose.runtime.remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, messages.lastOrNull()?.content?.length) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Column {
                    Text(name, fontWeight = FontWeight.Bold)
                    Text(if (modelReady) modelLabel else "IA pessoal · local", style = MaterialTheme.typography.labelSmall)
                } },
                actions = { TextButton(onClick = onOpenSettings) { Text("Configurações") } }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(status, style = MaterialTheme.typography.bodySmall)
                    if (loadingModel) {
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Text("Carregando modelo…", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(onClick = onSelectModel, enabled = !loadingModel && !generating, modifier = Modifier.weight(1f)) { Text("Modelo GGUF") }
                OutlinedButton(onClick = onImportText, enabled = !loadingModel && !generating, modifier = Modifier.weight(1f)) { Text("Importar TXT") }
                OutlinedButton(onClick = onOpenMemories, enabled = !generating, modifier = Modifier.weight(1f)) { Text("Memória") }
            }
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (messages.isEmpty()) {
                    item { Card(Modifier.fillMaxWidth().padding(top = 18.dp)) { Text(welcome, Modifier.padding(18.dp)) } }
                    item { Text("Comece por importar um modelo GGUF. Depois disso, o chat não precisa de internet.", Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.bodySmall) }
                }
                items(messages, key = { if (it.id >= 0) "db-${it.id}" else "temporary-${-it.id}" }) { message ->
                    MessageBubble(message)
                }
            }
            Surface(shadowElevation = 6.dp, color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().padding(10.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it.take(2_000) },
                            modifier = Modifier.weight(1f),
                            label = { Text("Mensagem") },
                            enabled = !generating && modelReady,
                            maxLines = 5,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text)
                        )
                        if (generating) {
                            Button(onClick = onCancelGeneration) { Text("Parar") }
                        } else {
                            Button(onClick = { val message = input.trim(); if (message.isNotEmpty()) { onSend(message); input = "" } }, enabled = modelReady && input.isNotBlank() && !loadingModel) {
                                Text("Enviar")
                            }
                        }
                    }
                    Text("Offline após preparar o motor e importar o modelo. A resposta do modelo pode conter erros.", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 5.dp))
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val isUser = message.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
        Card(
            modifier = Modifier.fillMaxWidth(if (isUser) 0.88f else 0.96f),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(Modifier.padding(12.dp)) {
                Text(if (isUser) "Você" else "IA local", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(message.content.ifBlank { "…" }, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun ProfileDialog(
    initial: AiProfile,
    onDismiss: () -> Unit,
    onSave: (AiProfile) -> Unit,
    onClearHistory: () -> Unit,
    onClearMemories: () -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit
) {
    var name by androidx.compose.runtime.remember(initial) { mutableStateOf(initial.name) }
    var description by androidx.compose.runtime.remember(initial) { mutableStateOf(initial.description) }
    var instructions by androidx.compose.runtime.remember(initial) { mutableStateOf(initial.instructions) }
    var tokenText by androidx.compose.runtime.remember(initial) { mutableStateOf(initial.maxTokens.toString()) }
    var welcome by androidx.compose.runtime.remember(initial) { mutableStateOf(initial.welcome) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Identidade e dados") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(name, { name = it.take(60) }, label = { Text("Nome da IA") }, singleLine = true)
                OutlinedTextField(description, { description = it.take(300) }, label = { Text("Descrição") }, maxLines = 2)
                OutlinedTextField(instructions, { instructions = it.take(4_000) }, label = { Text("Instruções de comportamento") }, minLines = 3, maxLines = 6)
                OutlinedTextField(tokenText, { tokenText = it.filter(Char::isDigit).take(3) }, label = { Text("Máximo de tokens por resposta (32–512)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(welcome, { welcome = it.take(300) }, label = { Text("Boas-vindas") }, maxLines = 2)
                Text("Salvar instruções e memórias não altera os pesos do modelo.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onExport) { Text("Exportar backup") }
                    TextButton(onClick = onImport) { Text("Importar backup") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onClearHistory) { Text("Apagar histórico") }
                    TextButton(onClick = onClearMemories) { Text("Apagar memórias") }
                }
            }
        },
        confirmButton = { Button(onClick = { onSave(AiProfile(name, description, instructions, tokenText.toIntOrNull()?.coerceIn(32, 512) ?: 192, welcome)) }) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Fechar") } }
    )
}

@Composable
private fun MemoriesDialog(
    memories: List<SavedMemory>,
    onDismiss: () -> Unit,
    onAdd: (String) -> Unit,
    onDelete: (Long) -> Unit,
    documents: List<LocalDocument>
) {
    var input by androidx.compose.runtime.remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Memória local") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Só salve informações com autorização. Elas ficam neste aparelho e podem ser apagadas.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(input, { input = it.take(2_000) }, label = { Text("Informação para memorizar") }, minLines = 2, maxLines = 4)
                Button(onClick = { if (input.isNotBlank()) { onAdd(input); input = "" } }, enabled = input.isNotBlank()) { Text("Salvar memória") }
                Text("Memórias salvas: ${memories.size}", fontWeight = FontWeight.SemiBold)
                LazyColumn(Modifier.height(170.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(memories, key = { it.id }) { memory ->
                        Card { Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(memory.content, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { onDelete(memory.id) }) { Text("Excluir") }
                        } }
                    }
                }
                Text("Documentos TXT importados: ${documents.size}. A busca por trechos usa palavras-chave locais.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Concluído") } }
    )
}

@Composable
private fun ModelsDialog(
    models: List<File>,
    activePath: String?,
    deviceInfo: String,
    onDismiss: () -> Unit,
    onImport: () -> Unit,
    onChoose: (File) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Modelos neste aparelho") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(10.dp)) {
                        Text("Recursos detectados", fontWeight = FontWeight.SemiBold)
                        Text(deviceInfo, style = MaterialTheme.typography.bodySmall)
                        Text("Sugestão inicial: modelo Q4 de 1–2B. Só teste 3–4B se o aparelho continuar estável; RAM disponível não é uma garantia.", style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (models.isEmpty()) Text("Nenhum arquivo GGUF foi importado ainda.")
                LazyColumn(Modifier.height(210.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(models, key = { it.absolutePath }) { model ->
                        Card {
                            Column(Modifier.fillMaxWidth().padding(10.dp)) {
                                Text(model.name, fontWeight = FontWeight.SemiBold)
                                Text("${"%.2f".format(model.length() / 1_000_000_000.0)} GB", style = MaterialTheme.typography.bodySmall)
                                if (model.absolutePath == activePath) Text("Modelo ativo", style = MaterialTheme.typography.labelMedium)
                                TextButton(onClick = { onChoose(model) }) { Text("Carregar") }
                            }
                        }
                    }
                }
                OutlinedButton(onClick = onImport, modifier = Modifier.fillMaxWidth()) { Text("Importar outro GGUF") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fechar") } }
    )
}
