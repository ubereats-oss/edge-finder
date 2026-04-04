import os

PASTA_RAIZ = os.path.dirname(os.path.abspath(__file__))

MAX_LINHAS_POR_PARTE = 1500  # controla truncamento no chat (ajuste se necessário)

IGNORAR_PASTAS = {
    '.git',
    'build',
    '.dart_tool',
    '.idea',
    '.vscode',
    'Pods',
    '.gradle',
    'node_modules',
    'assets',
}

EXTENSOES = {
    'codigo': {'.dart'},
    'config': {'.yaml', '.yml', '.gradle', '.kts', '.properties'},
    'outros': {'.md', '.txt'},
}

JSON_PERMITIDOS = {
    'firebase.json',
    'firestore.indexes.json',
    'analysis_options.json',
    'package.json',
    'google-services.json',
    'remote_config_defaults.json',
    'app_config.json',
    'env.json',
}

ARQUIVOS_NOMINAIS_PERMITIDOS = {
    'firestore.rules',
    'storage.rules',
}

ARQUIVOS_GERADOS_PREFIXOS = (
    'auditoria_codigo_parte_',
    'auditoria_config_parte_',
    'auditoria_outros_parte_',
)

ARQUIVOS_GERADOS_EXATOS = {
    os.path.basename(__file__),
}


def deve_ignorar_pasta(nome_pasta):
    return nome_pasta in IGNORAR_PASTAS


def eh_arquivo_gerado(nome_arquivo):
    if nome_arquivo in ARQUIVOS_GERADOS_EXATOS:
        return True
    for prefixo in ARQUIVOS_GERADOS_PREFIXOS:
        if nome_arquivo.startswith(prefixo) and nome_arquivo.endswith('.txt'):
            return True
    return False


def classificar_arquivo(caminho):
    nome = os.path.basename(caminho)
    ext = os.path.splitext(nome)[1].lower()
    rel = os.path.relpath(caminho, PASTA_RAIZ).replace('\\', '/')

    if eh_arquivo_gerado(nome):
        return None
    if nome in JSON_PERMITIDOS:
        return 'config'
    if nome in ARQUIVOS_NOMINAIS_PERMITIDOS:
        return 'config'
    if rel.startswith('lib/') and ext == '.dart':
        return 'codigo'
    for tipo, extensoes in EXTENSOES.items():
        if ext in extensoes:
            return tipo
    return None


def ler_arquivo_com_numeracao(caminho):
    with open(caminho, 'r', encoding='utf-8', errors='replace') as f:
        linhas = f.readlines()

    conteudo = [
        '==================================================\n',
        f'ARQUIVO: {caminho}\n',
        '==================================================\n',
    ]
    for i, linha in enumerate(linhas, start=1):
        conteudo.append(f'{i:4}: {linha}')
    if not linhas or not linhas[-1].endswith('\n'):
        conteudo.append('\n')
    conteudo.append('\n')
    return conteudo  # lista de linhas


def cabecalho_saida(tipo, parte):
    return [
        '==================================================\n',
        f'AUDITORIA DE CÓDIGO — {tipo.upper()} — Parte {parte}\n',
        f'Pasta raiz: {PASTA_RAIZ}\n',
        f'Limite: {MAX_LINHAS_POR_PARTE} linhas por parte\n',
        '==================================================\n\n',
    ]


def salvar_parte(tipo, parte, linhas):
    nome_saida = f'auditoria_{tipo}_parte_{parte}.txt'
    caminho_saida = os.path.join(PASTA_RAIZ, nome_saida)
    with open(caminho_saida, 'w', encoding='utf-8', newline='\n') as f:
        f.writelines(linhas)
    print(f'[OK] {nome_saida} ({len(linhas)} linhas)')


def coletar_arquivos():
    arquivos_por_tipo = {'codigo': [], 'config': [], 'outros': []}
    for dirpath, dirnames, filenames in os.walk(PASTA_RAIZ):
        dirnames[:] = [d for d in dirnames if not deve_ignorar_pasta(d)]
        for nome_arquivo in filenames:
            caminho = os.path.join(dirpath, nome_arquivo)
            tipo = classificar_arquivo(caminho)
            if tipo is not None:
                arquivos_por_tipo[tipo].append(caminho)
    for tipo in arquivos_por_tipo:
        arquivos_por_tipo[tipo].sort()
    return arquivos_por_tipo


def exportar_tipo(tipo, arquivos):
    if not arquivos:
        print(f'[OK] nenhum arquivo para {tipo}')
        return

    parte = 1
    buffer = cabecalho_saida(tipo, parte)
    linhas_atuais = len(buffer)
    cab_vazio = len(cabecalho_saida(tipo, parte))

    for caminho in arquivos:
        try:
            bloco = ler_arquivo_com_numeracao(caminho)
        except Exception as e:
            bloco = [
                '==================================================\n',
                f'ARQUIVO: {caminho}\n',
                '==================================================\n',
                f'[ERRO ao ler arquivo: {e}]\n\n',
            ]

        cab_bloco = bloco[:3]  # 3 linhas de cabeçalho do arquivo
        corpo = bloco[3:]

        # Arquivo grande: divide em fatias de MAX_LINHAS_POR_PARTE
        if len(bloco) > MAX_LINHAS_POR_PARTE:
            # Salva parte atual se tiver conteúdo além do cabeçalho
            if linhas_atuais > cab_vazio:
                salvar_parte(tipo, parte, buffer)
                parte += 1
                buffer = cabecalho_saida(tipo, parte)
                linhas_atuais = len(buffer)
                cab_vazio = linhas_atuais

            inicio = 0
            fatia_num = 1
            while inicio < len(corpo):
                espaco = MAX_LINHAS_POR_PARTE - cab_vazio - len(cab_bloco) - 1
                fatia = corpo[inicio:inicio + espaco]
                sub_cab = [
                    '==================================================\n',
                    f'ARQUIVO: {caminho} [fatia {fatia_num}]\n',
                    '==================================================\n',
                ]
                salvar_parte(tipo, parte, buffer + sub_cab + fatia + ['\n'])
                parte += 1
                buffer = cabecalho_saida(tipo, parte)
                linhas_atuais = len(buffer)
                cab_vazio = linhas_atuais
                inicio += len(fatia)
                fatia_num += 1
            continue

        # Arquivo normal: não cabe na parte atual → fecha e abre nova
        if linhas_atuais + len(bloco) > MAX_LINHAS_POR_PARTE:
            salvar_parte(tipo, parte, buffer)
            parte += 1
            buffer = cabecalho_saida(tipo, parte)
            linhas_atuais = len(buffer)
            cab_vazio = linhas_atuais

        buffer.extend(bloco)
        linhas_atuais += len(bloco)

    if linhas_atuais > cab_vazio:
        salvar_parte(tipo, parte, buffer)


def main():
    arquivos_por_tipo = coletar_arquivos()
    for tipo in ('codigo', 'config', 'outros'):
        print(f'\nProcessando {tipo}...')
        exportar_tipo(tipo, arquivos_por_tipo[tipo])
    print('\nFinalizado.')


if __name__ == '__main__':
    main()
