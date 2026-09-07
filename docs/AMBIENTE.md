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
