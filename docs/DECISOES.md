# Registro de decisões

Por que o projeto é como é. Fica no repositório de propósito: anotação em
máquina de desenvolvedor morre com a máquina, e o valor destas páginas está
justamente em sobreviver a ela.

A ordem é cronológica. **As decisões revertidas estão aqui de propósito** — saber
por que um caminho foi abandonado vale mais que saber qual foi escolhido, porque
é o que impede alguém de voltar a ele com as mesmas boas intenções.

---

## 1. O objetivo, e o que ele não é

**Decidido em 2026-09-07.**

Gravar partida de vôlei com o placar da súmula queimado no vídeo, **sem ninguém
tocar no celular**.

Hoje isso é feito com o SportCam, e o custo real não é o app: é que alguém tem de
preparar anotações na tela e apertar gravar — em geral um atleta que deveria estar
aquecendo com o time. **A ausência de operador é o requisito, não conveniência.**

Consequência: todo caminho que exija atenção humana na beira da quadra está
errado, mesmo que produza vídeo melhor.

---

## 2. Transmissão ao vivo é premissa

**Decidido em 2026-09-07, depois de uma reversão (ver 3).**

O placar tem de estar no frame no instante em que ele sai. Numa transmissão não
existe "depois".

Isso é o que decide a arquitetura inteira. Se algum dia a premissa cair, quase
tudo abaixo pode ser reconsiderado — mas enquanto ela valer, overlay em tempo
real não é escolha, é consequência.

---

## 3. REVERTIDO: gravar limpo e queimar depois

**Adotado em 2026-09-07, revertido no mesmo dia.**

O desenho original era: gravar o vídeo limpo, guardar um `timeline.json` com os
eventos do placar carimbados no tempo, e queimar o overlay depois no desktop com
ffmpeg.

Era tecnicamente bom — overlay em resolução cheia, zero disputa de CPU com a
captura, layout reeditável sem regravar. E funcionava: está provado com vídeo
sintético.

**Por que caiu:** resolvia um problema que não era o do projeto. O dono do
projeto apontou a prova em uma frase — *para inserir placar depois, não precisa
de app controlando câmera nenhuma*. Eu tinha construído bem a coisa errada como
caminho principal.

**Onde ele vive agora:** como recurso extra, para equipes que gravaram por conta
e querem inserir o placar sincronizando o início. O código continua no
repositório (`tools/burn.ts`, `tools/refazer.ts`, `src/recording/`) e continua
testado.

**Lição registrada:** a pergunta "isso exige app controlando a câmera?" separa o
núcleo do acessório neste projeto. Vale reaplicá-la.

---

## 4. React Native, e não app nativo puro

**Decidido em 2026-09-07.**

A superfície nativa necessária é pequena e estável: iniciar/parar preview,
iniciar/parar transmissão, iniciar/parar gravação, trocar o bitmap do overlay,
configurar câmera. Cinco chamadas.

Todo o resto — ler o convoca, decidir o que o placar diz, o canal remoto, a
interface — é lógica que já está escrita e testada em TypeScript, e onde mora o
conhecimento caro do contrato com o banco.

**A alternativa considerada** foi app Android nativo em Kotlin puro: uma
linguagem só, sem ponte, e a RootEncoder usada direto com todos os exemplos dela
valendo. Custo: reescrever ~800 linhas de TS. Foi descartada porque o iOS está no
horizonte e a camada TS se reaproveita, mas o argumento de "menos peças móveis" é
legítimo e a decisão pode ser revista se a ponte der problema.

---

## 5. Android primeiro; iOS depende de dinheiro

**Decidido em 2026-09-07.**

Instalar app com câmera própria em iPhone exige conta Apple Developer paga
(US$ 99/ano). Não há contorno: build nativo precisa de provisionamento.

Android: conta Expo gratuita, build na nuvem, APK instalado direto.

O dono do projeto tem os dois aparelhos e escolheu começar pelo Android. O código
é o mesmo; o que muda é o módulo nativo.

---

## 6. RootEncoder no Android, HaishinKit no iOS

**Decidido em 2026-09-07, após pesquisa.**

| plataforma | biblioteca | faz |
|---|---|---|
| Android | [RootEncoder](https://github.com/pedroSG94/RootEncoder) | overlay OpenGL em tempo real, RTMP/RTSP/SRT, gravação MP4 **simultânea** ao stream |
| iOS | [HaishinKit.swift](https://github.com/HaishinKit/HaishinKit.swift) | `VideoEffect` com `CISourceOverCompositing`, RTMP/SRT |

**Nenhuma tem ponte mantida para React Native.** Conferido no npm em 2026-09-07:
`react-native-rtmp-publisher` parou em 2023, `react-native-live-stream` em 2022, e
`react-native-nodemediaclient` (out/2025) não expõe overlay. Módulo nativo é
inevitável em qualquer caminho.

O overlay entra como **bitmap** nas duas. É por isso que o pipeline daqui produz
um PNG por estado do placar: o formato já é o que a biblioteca quer.

---

## 7. DESCARTADO: VisionCamera

**Instalado em 2026-09-07, removido no mesmo dia.**

Dois motivos independentes, e cada um bastaria:

1. **Ela não queima overlay no arquivo.** Nem a v4 nem a v5. O `Recorder` grava
   os frames crus da câmera; o `FrameRenderer` da v5 desenha numa *view*. A
   própria documentação diz que dá para "construir um gravador customizado que
   aceita Frames" — ou seja, é ponto de extensão nativo, não recurso.
2. **Ela disputaria a câmera com o encoder de streaming.** A RootEncoder toma
   conta de câmera, preview e encoder.

Nota para quem for pesquisar: a **v5 é uma reescrita completa** sobre Nitro
(`useCamera`, `useVideoOutput`, `usePreviewOutput`). Praticamente todo tutorial
de VisionCamera na internet descreve a v4 e não se aplica. Ela também **não tem
config plugin do Expo** na v5, ao contrário da v4 — permissões vão à mão no
`app.json`.

---

## 8. DESCARTADO: ffmpeg no aparelho

**Decidido em 2026-09-07, após pesquisa.**

O FFmpegKit foi aposentado em janeiro/2025 e os binários saíram do Maven Central
e do CocoaPods em abril/2025. O que restou no npm é uma dúzia de forks pessoais
(`@wokcito/`, `@nikhil-cephei/`, `kroog-`, `@apescoding/`…) sem sucessor claro.

**O modo de falha é o problema:** `npm install` funciona e o build nativo quebra.

Fica registrado que **para clipe curto a conta muda**: 30 segundos queimam em
poucos segundos até em aparelho modesto, e o risco fica contido porque o clipe é
descartável. Se a necessidade de postar do ginásio voltar, este é o único
contexto em que um desses forks seria defensável.

---

## 9. Publicar num endereço RTMP único

**Decidido em 2026-09-07.**

O app manda para **um** endereço estático. A distribuição para YouTube e
Instagram fica com um serviço de restream.

Três razões, e a terceira é a que manda:

1. O app não precisa saber que Instagram existe.
2. **A chave do Instagram é temporária** — expira quando a live encerra ou a
   janela do Live Producer fecha. Buscar chave nova no navegador antes de cada
   jogo é exatamente o atrito que o projeto existe para eliminar (ver 1).
3. Internet de ginásio não aguenta dois uploads simultâneos. Dois destinos
   diretos do celular significam dois encoders e o dobro de banda subindo.

**Pendente de verificação:** se o serviço de restream lida com a chave temporária
do Instagram automaticamente, ou se sobra passo manual em algum lugar.

---

## 10. DESCARTADO: máscara ou plugin dentro do Instagram

**Investigado em 2026-09-07.**

Não é difícil — é impossível. O **Meta Spark foi desligado em 14/01/2025** e os
efeitos de terceiros foram *removidos* do Instagram, Facebook e Messenger. Só os
efeitos próprios da Meta continuam.

Mesmo que existisse, o sandbox do Spark AR tinha rede severamente restrita: uma
máscara que consulta placar ao vivo a cada ponto era o pior caso possível
naquela plataforma.

---

## 11. Instagram: Reels por pós-processamento, Live opcional

**Decidido em 2026-09-07.**

"Instagram" são duas coisas diferentes:

| | precisa de transmissão? |
|---|---|
| Instagram **Live** | sim — RTMP, chave temporária, atrito |
| **Reels / post** | não — é só o arquivo |

Reels vai por pós-processamento, com corte escolhido com calma. Instagram Live
sai do caminho crítico: entra depois por um endereço RTMP configurável, sem
mudança de arquitetura.

---

## 12. Os três disparos da gravação

**Decidido em 2026-09-07.**

Escolhidos os três juntos, e cada um cobre uma falha do outro:

1. **Página web no celular do operador** — alcance ilimitado, funciona da mesa de
   súmula. Canal em `supabase/gravacao/001`.
2. **Controle Bluetooth de selfie** — tecla de volume, zero rede, alcance ~10m.
   Para quando não há sinal.
3. **Automático no primeiro ponto** — rede de segurança, para nunca perder um
   jogo porque ninguém apertou REC.

Descartada a rede local / hotspot: depende de Wi-Fi de ginásio, e alguns
roteadores isolam os aparelhos entre si.

**Nota importante:** o disparo automático no primeiro ponto **não serve** como
único mecanismo, porque a abertura (arbitragem e escalações) tem de rodar
*antes* do apito. Quando o primeiro ponto sai, já é tarde para ela.

---

## 13. Orientação: as duas, escolhidas pela geometria

**Decidido em 2026-09-07.**

Vertical não é o horizontal reposicionado. Três coisas mudam por razões
diferentes:

1. **Vai em cima.** O Instagram desenha a própria interface sobre os ~22%
   inferiores do Reels — legenda, áudio, botões. A tarja inferior, que é a
   posição certa no 16:9, fica **coberta**. A área de baixo não é nossa.
2. **É mais larga em proporção.** No 16:9 a tarja ocupa ~24% da largura; a mesma
   largura absoluta num quadro de 1080 ocuparia 43%.
3. **Tipo maior.** Vertical se assiste no celular.

O layout é escolhido pela **forma do quadro**, não por configuração: um vídeo
9:16 com a tarja de 16:9 fica errado qualquer que fosse a intenção de quem
gravou. Assim não há estado a configurar errado.

---

## 14. Fronteira com o schema `rede`

**Acordado em 2026-09-07 com o dono do schema.**

**Este projeto lê `rede` por função e nunca escreve migration nele.**

O motivo é mecânico, não de zelo: as migrations do AVF vivem fazendo
`create or replace` nos mesmos objetos e são aplicadas à mão no SQL Editor. Duas
sequências não colidem por número, colidem por **ordem** — a última a rodar apaga
a outra em silêncio, e não há ferramenta que pegue isso.

O que o app precisa guardar vai no schema `gravacao`, com numeração própria a
partir de 001.

Para bug ou falta em `rede`, o protocolo é **relatório, não SQL**:

> função/tabela · chamada exata (URL + headers + corpo) · o que voltou · o que
> esperava e por quê · **dá para contornar do meu lado?**

O último campo é o que mais economiza tempo. Na prática, metade dos "preciso de
uma migration" era `Accept-Profile: rede` faltando.

**Namespace reservado:** `public.gravacao_*`. Confirmado livre pelo dono do
schema.

---

## 15. Contrato por função, nunca por forma de tabela

**Decidido em 2026-09-07, corrigindo uma dependência que já existia.**

A reconstrução da timeline lia `sumula_rallies` e `sumula_sets` cruas, e refazia
por conta duas regras do dono do schema: o filtro do cursor
(`ordem <= rallies_ativos`) e a dobra do placar.

**Por que isso era grave**, e o argumento não é sobre forma de tabela: aquela era
a **terceira implementação** da regra de "quais rallies contam" — as outras duas
são a `sumula_status` e a tela do app do AVF. Essa triplicação já havia produzido
um ponto fantasma no fim do set.

E a nossa cópia estava certa **porque nos avisaram, não porque foi verificada**:
a súmula de teste tinha um rally só, então nenhum teste daqui jamais havia
exercitado um desfazer real. O bug teria passado em 19 testes verdes.

**VERIFICADO em 2026-09-07** na súmula `246cd719`, com um desfazer de verdade
(4x4 → 4x3) deixando linha órfã na tabela:

```
linhas cruas na tabela  : 8   (ordens 1..8)
cursor (rallies_ativos) : 7
sumula_timeline entrega : 7   -> ultimo ord7, 4x3
sumula_status           : 4x3
reconstrucao daqui      : 8 eventos, terminando em 4x3
```

A linha `ordem 8` existe e foi descartada por todos. Se o filtro falhasse,
viria 5x3 — o ponto fantasma. Deixou de ser fé e passou a ser fato.

A migration 126 expôs `sumula_timeline`, e o join e a dobra foram apagados
daqui. Sobrou uma regra derivada (`alvoDoSet`), e ela sai de `formato`, que é
campo de contrato — **derivar de valor contratado é diferente de duplicar um
filtro sobre linhas cruas.**

**Dívida conhecida que ficou:** `src/data/abertura.ts` ainda lê tabelas cruas. A
assimetria justifica: a abertura roda *antes* do jogo, então uma quebra aparece
como cartão errado na hora, e ninguém perde gravação. Na reconstrução, a mesma
quebra sairia num vídeo já publicado.

---

## 16. Âncora de relógio por interseção de intervalos

**Decidido em 2026-09-07, substituindo um estimador que estava errado.**

O estimador anterior usava `observedAt - atualizado_em`. Mas `atualizado_em` é
instante **passado** — a hora da última escrita, não "agora". Aquela subtração
media **obsolescência do dado**, não desvio de relógio: se o último ponto foi há
quatro minutos, ela dava quatro minutos de "desvio". Era lixo com cara de
estatística.

O que existe agora: para um pedido enviado em `t0` e recebido em `t1`, cujo corpo
diz que no servidor era `s` com granularidade `g`,

```
t0 - (s + g)  <=  offset  <=  t1 - s
```

Cada amostra aperta um lado. Isso trata fontes de precisão diferente sem código
especial: o campo `agora` das funções `gravacao_*` (`clock_timestamp()`, g ≈ 1ms)
aperta muito; o header `Date` do PostgREST (g = 1000ms) aperta pouco, mas resolve
deriva de minutos e funciona em qualquer chamada.

**Por que `clock_timestamp()` e não `now()`:** `now()` é
`transaction_timestamp()` — congela no início da transação, e um
`select ... for update` pode ficar esperando lock. `clock_timestamp()` lê o
relógio de parede na hora da chamada, então a espera cai no RTT e não no `g`.
Amostra lenta fica assimétrica, não inválida.

Celular adiantado não é hipótese: o app web do AVF já precisou tratar `PGRST303`
/ "issued at future" com estes mesmos aparelhos.

---

## 17. Timeline guarda estado completo, não diff

**Decidido em 2026-09-07.**

Cada entrada da timeline carrega o estado **inteiro** do placar, não a diferença.
Redundante de propósito: se o consumidor somasse eventos, um evento perdido
desalinharia todo o resto do vídeo — e o erro só apareceria no arquivo final,
quando não há como regravar.

Cada carimbo também declara **procedência** (`precisao`), porque não são
equivalentes:

- `rally` — de `sumula_rallies.criado_em`. Hora do ponto, exata.
- `escrita` — de `atualizado_em`. Aproximado, e **o erro não tem teto pequeno**.
  Eu havia estimado que ficaria "limitado ao intervalo de polling"; está
  verificado que não. Medido em 2026-09-07 na súmula `246cd719`:

  ```
  atualizado_em             : 20:03:00.677   <- o desfazer
  ultimo rally ATIVO (ord7) : 19:55:49.725
  ```

  **7 minutos e 11 segundos.** O desfazer é escrita que move `atualizado_em` e
  não cria rally nenhum, então o desvio é o tempo desde o último ponto de
  verdade — que pode ser qualquer coisa. Daí a reconstrução ser a fonte de
  produção, e não este caminho.
- `local` — nenhuma escrita conhecida; sobrou o relógio do aparelho.

---

## Pendências e coisas a verificar

- Se o serviço de restream resolve a chave temporária do Instagram sem passo
  manual (ver 9).
- O módulo nativo Kotlin não existe ainda. É o próximo passo e o coração do
  projeto.
- A tela de captura não existe. Não há `App.tsx` nem `main` no `package.json`.
- Nada do lado nativo pode ser verificado sem build em aparelho físico.
