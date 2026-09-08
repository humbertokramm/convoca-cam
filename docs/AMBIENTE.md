# Ambiente de desenvolvimento

O que está instalado, onde, e por que essas escolhas. Serve para retomar o
projeto em outra máquina sem redescobrir tudo.

## Aparelho de teste

```
Xiaomi Redmi Note 10S (M2101K7AG, codinome sunny_global)
Android 12, API 31, arm64-v8a
```

Encoders de vídeo **em hardware**, confirmados no aparelho:

| codec | encoder |
|---|---|
| H.264 | `OMX.qcom.video.encoder.avc` |
| HEVC | `OMX.qcom.video.encoder.hevc` |

O H.264 em hardware é a peça que viabiliza o projeto: é ele que a RootEncoder
usa para comprimir o vídeo com o overlay já composto, sem torrar a CPU. Com
encoder por software, transmitir 1080p seria sofrimento térmico.

## adb sem fio, e por que não USB

A porta USB deste aparelho não funciona para dados. A depuração é **sem fio**,
nativa do Android 11+.

```
adb: C:\Users\humbe\Desktop\platform-tools\adb.exe   (versão 37.0.1)
```

Só o pacote **platform-tools** (~10 MB), sem Android Studio. A compilação é
feita na nuvem pelo EAS; o `adb` local serve para instalar o APK e ler o
`logcat` — sem ele, depurar código nativo viraria adivinhação por procuração.

### Como reconectar

O emparelhamento sobrevive a reinícios, mas o endereço muda. Em geral basta:

```bash
adb devices -l
```

Se aparecer vazio ou `offline`, no celular: **Opções do desenvolvedor →
Depuração sem fio**, e usar o `IP:porta` da tela principal:

```bash
adb connect <ip>:<porta>
```

Se o emparelhamento tiver sido perdido, refazer por **"Emparelhar dispositivo
com código de emparelhamento"** — o endereço e o código dessa tela são
diferentes dos da tela principal, e ambos mudam a cada abertura:

```bash
adb pair <ip>:<porta-de-pareamento> <codigo>
```

### Armadilhas que já custaram tempo aqui

- **O código de emparelhamento é de uso único e expira rápido.** Se demorar
  entre ler e executar, falha com `protocol fault (couldn't read status
  message)` — que parece erro de rede e não é.
- **A porta de emparelhar não é a porta de conectar.** São telas diferentes.
- **A tela do celular precisa ficar acesa.** O Android derruba conexões de rede
  quando a tela apaga.
- Se o ping da rede local vier alto (foi 113ms aqui, contra 1-20ms esperados), é
  sinal de Wi-Fi fraco ou economia de energia — e vira falha intermitente de
  `adb`.

## Build local no Windows (o caminho que funciona)

Não precisa de WSL nem de Ubuntu. O `eas build --local` é que recusa rodar no
Windows; o build nativo comum funciona:

```bash
npx expo prebuild --platform android
cd android && ./gradlew :app:assembleDebug
```

Variáveis necessárias — **os caminhos não são os padrões**, ver o porquê abaixo:

```
JAVA_HOME        C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot
ANDROID_HOME     D:\devndroid-sdk
GRADLE_USER_HOME D:\dev\gradle
```

### Compile por `D:\git\pessoal\convoca-cam`, NUNCA por `P:\pessoal\convoca-cam`

O `P:` desta máquina é um **mapeamento de `D:\git`** — os mesmos arquivos, duas
letras de disco. Compilar pelo `P:` faz o Kotlin morrer assim:

```
java.lang.IllegalArgumentException: this and base files have different roots:
  D:\git\pessoal\convoca-cam
ode_modules\expo-constants\...\ConstantsModule.kt
  e
  P:\pessoal\convoca-camndroid
```

O `RelocatableFileToPathConverter` do compilador incremental calcula caminho
relativo entre os arquivos e a raiz do projeto. Parte dos caminhos chega como
`D:\...` (via `node_modules` resolvido pelo Gradle) e parte como `P:\...` (a
raiz que a linha de comando passou), e ele estoura porque as raízes diferem.

O sintoma engana: aparece como `Internal compiler error` em
`:convoca-encoder:compileDebugKotlin`, o que faz parecer erro no nosso Kotlin.
**Não é** — o compilador nem chega a analisar o código, morre antes na
resolução de caminho. Não havia uma única linha `e:` no log.

Se topar com isso de novo: rodar de `D:\git\pessoal\convoca-cam`, e limpar os
caches incrementais com `./gradlew clean` mais `-Pkotlin.incremental=false`,
porque os caches escritos na sessão de raiz mista ficam envenenados.

### Por que fora do C:

O `C:` deste PC tem 195 GB e estava em **100%** de uso. O primeiro build rodou
10 minutos e morreu com `java.io.IOException: Espaço insuficiente no disco` —
não por erro de código.

O cache do Gradle cresce vários GB ao longo de um projeto, então deixá-lo no
disco cheio garantiria o mesmo problema de novo. Cache e SDK foram movidos para
o volume com espaço.

### JDK: 17, e nenhum outro

A máquina tem o JDK 24 no PATH e o Android Studio traz um JBR 25 embutido. **Os
dois são novos demais** para o Gradle do React Native 0.86. O 17 é o certo, e
isso não é chute: a imagem do builder do EAS é
`ubuntu-26.04-jdk-17-ndk-r27b-sdk-57`.

### Android Studio não é necessário

Foi instalado e **não é usado**. O SDK inteiro se instala por linha de comando:

```bash
# build atual em https://dl.google.com/android/repository/repository2-3.xml
curl -sL "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip" -o clt.zip
# extrair de forma que fique em <sdk>/cmdline-tools/latest/bin/
sdkmanager "platforms/android-36" "build-tools/36.0.0" "platform-tools"
```

Duas armadilhas aqui:

- **A URL de download que a página `developer.android.com/studio` informa dá
  404.** O caminho válido é `dl.google.com/android/repository/`, e o número de
  build sai do `repository2-3.xml` — não da página.
- **A sintaxe de pacote mudou de `;` para `/`.** O `sdkmanager` desta versão é
  um invólucro do CLI novo `android`, e com `platforms;android-36` ele responde
  "Package not found" para cada pedaço separadamente — o que parece falha de
  rede e não é.

## Máquina de desenvolvimento

```
Windows 10, Node 24.19, npm 11.17
ffmpeg/ffprobe: C:\ffmpeg\bin  (build completo, para o burn de pós-processamento)
```

**Cuidado com o JDK:** a máquina tem JDK 24 no PATH, que é novo demais para o
Gradle do React Native 0.86. Isso não atrapalha enquanto as builds forem na
nuvem (o EAS usa o próprio JDK). Se algum dia migrarmos para build local, será
preciso um JDK 17 e apontar `JAVA_HOME` para ele.

## EAS

```
projeto: @convoca.net/convoca
id     : 7bdfe07f-0b25-43a0-97d4-078f09594e14
```

Plano gratuito: **15 builds Android por mês**, fila de baixa prioridade
(minutos em horário calmo, mais de uma hora em pico), limite de 45 min por
build.

Esse teto é apertado para desenvolver módulo nativo. A escada de escape, se ele
incomodar:

1. **cmdline-tools + JDK 17** (~2-3 GB) — builds locais ilimitadas, sem IDE
2. **Android Studio** (~10 GB) — o acima, mais editor Kotlin e emulador
