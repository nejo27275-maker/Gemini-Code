package com.nitido.gpu

object Hint {
    fun next(canOverlay: Boolean, notifOk: Boolean, wantPrecise: Boolean, accOn: Boolean, running: Boolean): String = when {
        !canOverlay -> "Passo 1: toque em Iniciar e permita "Sobrepor a outros apps"."
        wantPrecise && !accOn -> "Passo 2: ative "Nítido GPU (overlay preciso)" em Acessibilidade (ou desmarque o Modo preciso)."
        running -> "Rodando. Pode mexer nos ajustes: eles se aplicam sozinhos."
        !notifOk -> "Dica: permita notificações para ter o botão Parar. Depois toque em Iniciar."
        else -> "Pronto: toque em Iniciar e escolha "Tela inteira"."
    }
}