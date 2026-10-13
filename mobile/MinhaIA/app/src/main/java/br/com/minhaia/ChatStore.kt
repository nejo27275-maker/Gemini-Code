package br.com.minhaia

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

 data class ChatMessage(
    val id: Long,
    val role: String,
    val content: String,
    val createdAt: Long
)

data class SavedMemory(val id: Long, val content: String, val createdAt: Long)
data class LocalDocument(val id: Long, val name: String, val content: String, val createdAt: Long)

/** SQLite-only local persistence. No network or analytics are used here. */
class ChatStore(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Upgrade steps must preserve existing data; never drop tables silently.
        if (oldVersion < 2) {
            // Reserved for the next schema migration.
        }
    }

    @Synchronized fun addMessage(role: String, content: String): Long {
        require(role == "user" || role == "assistant")
        val v = ContentValues().apply {
            put("role", role)
            put("content", content)
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insertOrThrow("messages", null, v)
    }

    @Synchronized fun recentMessages(limit: Int = 12): List<ChatMessage> {
        val out = mutableListOf<ChatMessage>()
        readableDatabase.rawQuery(
            "SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT ?",
            arrayOf(limit.coerceIn(1, 100).toString())
        ).use { c ->
            while (c.moveToNext()) out += ChatMessage(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3))
        }
        return out.asReversed()
    }

    @Synchronized fun allMessages(): List<ChatMessage> = recentMessages(100)

    @Synchronized fun clearMessages() { writableDatabase.delete("messages", null, null) }

    @Synchronized fun addMemory(content: String): Long {
        val clean = content.trim()
        require(clean.isNotEmpty() && clean.length <= 2_000) { "A memória deve ter de 1 a 2.000 caracteres." }
        val v = ContentValues().apply { put("content", clean); put("created_at", System.currentTimeMillis()) }
        return writableDatabase.insertOrThrow("memories", null, v)
    }

    @Synchronized fun memories(): List<SavedMemory> {
        val out = mutableListOf<SavedMemory>()
        readableDatabase.rawQuery("SELECT id, content, created_at FROM memories ORDER BY id DESC", null).use { c ->
            while (c.moveToNext()) out += SavedMemory(c.getLong(0), c.getString(1), c.getLong(2))
        }
        return out
    }

    @Synchronized fun deleteMemory(id: Long) { writableDatabase.delete("memories", "id=?", arrayOf(id.toString())) }
    @Synchronized fun clearMemories() { writableDatabase.delete("memories", null, null) }

    @Synchronized fun addDocument(name: String, content: String): Long {
        val cleanName = name.take(200).ifBlank { "documento.txt" }
        val cleanText = content.take(MAX_DOCUMENT_CHARS)
        val v = ContentValues().apply {
            put("name", cleanName)
            put("content", cleanText)
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insertOrThrow("documents", null, v)
    }

    @Synchronized fun documents(): List<LocalDocument> {
        val out = mutableListOf<LocalDocument>()
        readableDatabase.rawQuery("SELECT id, name, content, created_at FROM documents ORDER BY id DESC", null).use { c ->
            while (c.moveToNext()) out += LocalDocument(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3))
        }
        return out
    }

    @Synchronized fun deleteDocument(id: Long) { writableDatabase.delete("documents", "id=?", arrayOf(id.toString())) }

    /** Keyword-overlap retrieval: fast, local, deterministic; not a semantic vector database. */
    @Synchronized fun relevantMemories(query: String, limit: Int = 4): List<String> {
        val q = terms(query)
        if (q.isEmpty()) return emptyList()
        return memories().map { memory -> memory.content to score(q, terms(memory.content)) }
            .filter { it.second > 0 }.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    @Synchronized fun relevantDocumentSnippets(query: String, limit: Int = 3): List<String> {
        val q = terms(query)
        if (q.isEmpty()) return emptyList()
        val candidates = mutableListOf<Pair<String, Int>>()
        for (document in documents()) {
            document.content.split(Regex("(?<=[.!?])\\s+|\\n+")).forEach { paragraph ->
                val p = paragraph.trim()
                if (p.isNotEmpty()) {
                    val s = score(q, terms(p))
                    if (s > 0) candidates += ("${document.name}: ${p.take(700)}" to s)
                }
            }
        }
        return candidates.sortedByDescending { it.second }.take(limit).map { it.first }
    }

    @Synchronized fun exportBackup(): String {
        val root = JSONObject().put("schema", 1).put("exportedAt", System.currentTimeMillis())
        root.put("messages", JSONArray().also { a -> allMessages().forEach { a.put(JSONObject().put("role", it.role).put("content", it.content).put("createdAt", it.createdAt)) } })
        root.put("memories", JSONArray().also { a -> memories().forEach { a.put(JSONObject().put("content", it.content).put("createdAt", it.createdAt)) } })
        root.put("documents", JSONArray().also { a -> documents().forEach { a.put(JSONObject().put("name", it.name).put("content", it.content).put("createdAt", it.createdAt)) } })
        return root.toString(2)
    }

    @Synchronized fun importBackup(json: String) {
        require(json.length <= MAX_BACKUP_CHARS) { "Backup muito grande." }
        val root = JSONObject(json)
        require(root.optInt("schema", -1) == 1) { "Versão de backup não suportada." }
        val messagesArray = root.optJSONArray("messages") ?: JSONArray()
        val memoryArray = root.optJSONArray("memories") ?: JSONArray()
        val documentsArray = root.optJSONArray("documents") ?: JSONArray()
        require(messagesArray.length() <= 10_000 && memoryArray.length() <= 2_000 && documentsArray.length() <= 100) {
            "O backup excede os limites permitidos."
        }
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (i in 0 until messagesArray.length()) {
                val item = messagesArray.optJSONObject(i) ?: continue
                val role = item.optString("role")
                val body = item.optString("content")
                if ((role == "user" || role == "assistant") && body.length <= 100_000) {
                    db.insert("messages", null, ContentValues().apply { put("role", role); put("content", body); put("created_at", item.optLong("createdAt", System.currentTimeMillis())) })
                }
            }
            for (i in 0 until memoryArray.length()) {
                val item = memoryArray.optJSONObject(i) ?: continue
                val body = item.optString("content").trim()
                if (body.isNotEmpty() && body.length <= 2_000) {
                    db.insert("memories", null, ContentValues().apply { put("content", body); put("created_at", item.optLong("createdAt", System.currentTimeMillis())) })
                }
            }
            for (i in 0 until documentsArray.length()) {
                val item = documentsArray.optJSONObject(i) ?: continue
                val body = item.optString("content")
                if (body.length <= MAX_DOCUMENT_CHARS) {
                    db.insert("documents", null, ContentValues().apply {
                        put("name", item.optString("name", "documento.txt").take(200))
                        put("content", body)
                        put("created_at", item.optLong("createdAt", System.currentTimeMillis()))
                    })
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private fun terms(text: String): Set<String> = Regex("[\\p{L}\\p{N}]{3,}")
        .findAll(text.lowercase())
        .map { it.value }
        .toSet()

    private fun score(a: Set<String>, b: Set<String>): Int = a.count { it in b }

    companion object {
        private const val DB_NAME = "minhaia-local.db"
        private const val DB_VERSION = 1
        const val MAX_DOCUMENT_CHARS = 1_000_000
        const val MAX_BACKUP_CHARS = 12_000_000
    }
}
