# Build do EAS falha antes de instalar dependências

**Aberto em 2026-09-07. Não resolvido.** Seis builds consumidas, todas com a
mesma falha.

## O sintoma

A build morre entre `PRE_INSTALL_HOOK` e `INSTALL_DEPENDENCIES`, **sem produzir
uma única linha de log de erro**. O log completo das fases:

```
SPIN_UP_BUILDER        → ok
INSTALL_CUSTOM_TOOLS   → ok
PREPARE_PROJECT        → ok  ("Normalizing project source permissions")
PRE_INSTALL_HOOK       → ok
                       ← falha silenciosa aqui
ON_BUILD_ERROR_HOOK    → ok
ON_BUILD_COMPLETE_HOOK → ok
FAIL_BUILD             → "Build failed"
```

Mensagem da API: `UNKNOWN_ERROR` — *"Unknown error. See logs of the Build
complete hook build phase for more information."* Aquela fase não tem
informação nenhuma; é só a última a rodar.

Duração: ~6,6s de build, ~5,5s de fila.

## Por que isso exonera o projeto

`INSTALL_DEPENDENCIES` **nunca roda**. Logo nenhuma dependência é instalada,
nenhum Kotlin é compilado, nenhum JavaScript é empacotado, nenhum plugin de
configuração é executado. Nada deste repositório é tocado.

O que o EAS lê antes desse ponto é apenas: o arquivo enviado, `package.json`,
`app.json` e `eas.json`.

## Builds consumidas e o que cada uma testou

| build | o que mudou | resultado |
|---|---|---|
| `5cc4e3fa` | primeira tentativa | falhou |
| `8db7120e` | sem `channel`, sem `userInterfaceStyle`, `android/` ignorado | falhou |
| `5fc13e3d` | sem `newArchEnabled`, TypeScript 6.0.3 (doctor 21/21) | falhou |
| `2e3f3e8c` | `eas.json` gerado pelo `eas build:configure` | falhou |
| `2d5d45b4` | perfil `preview` (sem `developmentClient`) | falhou |
| `1c65c851` | `EAS_SKIP_AUTO_FINGERPRINT=1` | falhou |

## O que foi verificado e descartado

- `npx expo-doctor` → **21/21**, nenhum problema
- `npx expo prebuild --platform android` → passa localmente
- `eas.json` → substituído pelo gerado por `eas build:configure`
- `npm ci --dry-run` → lockfile em sincronia; `lockfileVersion: 3`, compatível
  com o npm 10.9.8 do builder
- `package.json`, `app.json`, `eas.json` → JSON válido, sem BOM
- Sem `.npmrc`, sem `engines`, sem `packageManager`, um único lockfile
- Autolinking encontra o módulo local (`--platform android`; o padrão do
  comando é `apple`, o que engana)
- status.expo.dev → sem incidentes nas 24h
- 48 arquivos versionados, arquivo enviado de 269 KB

## O que NÃO foi possível testar

`eas build --local` recusa rodar: *"Unsupported platform, macOS or Linux is
required to build apps for Android"*. Sem isso, cada hipótese custa uma das 15
builds mensais do plano gratuito.

**Saída, se for preciso:** WSL2 com Ubuntu, JDK 17 e cmdline-tools do Android
(~3-4 GB). Torna a iteração livre e mostra o erro real em vez de adivinhar.

## Como ler o log de uma build do EAS

Duas armadilhas que custaram tempo aqui:

**O log vem em BROTLI.** `curl` sem `--compressed` grava o corpo cru, e o
arquivo parece binário corrompido. Um loop que tenta descompressões em sequência
precisa tentar brotli **antes** de `inflateRawSync` — este último "tem sucesso"
devolvendo poucos bytes de lixo, e quem confiar no retorno sai com a resposta
errada.

**`eas build:view` não aceita `--non-interactive`.** Com essa flag o comando
falha inteiro. Um monitor construído assim fica imprimindo erro sem informar
nada.

O caminho que funciona:

```bash
npx eas-cli build:view <id> --json > bv.json
# extrair logFiles[0] e então:
curl -s --compressed "<url>" -o build.log   # JSON-lines, um objeto por linha
```

## Lições registradas

**Rodar `expo-doctor` ANTES de gastar build.** Ele achou em segundos
(`newArchEnabled` fora do schema do SDK 57, TypeScript com um major de
diferença) o que duas builds e uma pilha de palpites não acharam.

**Usar o gerador da ferramenta antes de escrever configuração à mão.** O
`eas.json` escrito à mão tinha `android.buildType` redundante; o
`newArchEnabled` era hábito de SDK antigo. Os dois vieram do mesmo erro.

**`expo prebuild` cria `android/` e ela precisa estar no `.gitignore`.**
Committar aquilo mudaria o projeto para o fluxo "bare", e o EAS passaria a usar
a pasta versionada em vez de gerar a dele — com sintoma confuso. Foi o achado
mais perigoso desta sessão, e não era a causa da falha.
