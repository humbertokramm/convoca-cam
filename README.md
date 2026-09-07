# convoca-cam

Grava partidas de vôlei com o placar da súmula do [convoca.net](https://convoca.net)
**queimado no vídeo**, sem ninguém precisar tocar no celular.

O problema que ele resolve: hoje isso é feito com o SportCam, e exige alguém
preparando anotações na tela e apertando gravar — em geral um atleta que
deveria estar aquecendo com o time.

## Estado

O núcleo de dados está pronto e verificado contra a API real. **O aplicativo em
si ainda não existe** — não há ponto de entrada (`App.tsx`), e a captura de
vídeo é o próximo passo.

| | |
|---|---|
| Contrato com o convoca (placar, escalação, arbitragem) | pronto |
| Layouts de placar, horizontal e vertical | pronto |
| Canal de comando do controle remoto | pronto, aplicado no banco |
| Âncora de relógio servidor↔aparelho | pronto |
| Reconstrução da timeline pós-jogo | pronto |
| Burn no desktop (ffmpeg) | pronto |
| Captura de vídeo com overlay em tempo real | **a fazer** |
| Transmissão RTMP | **a fazer** |

> **A build não passa.** Seis tentativas no EAS falharam antes de instalar
> dependências, sem log de erro. A ordem das fases exonera este repositório —
> nada aqui é tocado nesse ponto. Evidência completa e caminhos de saída em
> [`docs/PROBLEMA-BUILD.md`](docs/PROBLEMA-BUILD.md).

## Decisões de arquitetura

O registro completo, com o porquê de cada escolha e **das que foram revertidas**,
está em [`docs/DECISOES.md`](docs/DECISOES.md). Fica no repositório de propósito:
anotação em máquina de desenvolvedor morre com a máquina. O resumo:

**Overlay em tempo real, Android primeiro.** Transmissão ao vivo é premissa do
projeto, e numa transmissão não existe "depois": o placar tem de estar no frame
no instante em que ele sai. Isso descarta gravar limpo e queimar depois como
caminho principal.

A biblioteca que faz isso no Android é a
[RootEncoder](https://github.com/pedroSG94/RootEncoder): overlay OpenGL em tempo
real, RTMP/RTSP/SRT, e gravação MP4 **simultânea** ao stream. No iOS o
equivalente é a [HaishinKit.swift](https://github.com/HaishinKit/HaishinKit.swift).
Nenhuma das duas tem ponte mantida para React Native — módulo nativo é
inevitável.

O overlay entra como **bitmap**, e é por isso que o pipeline daqui produz um PNG
por estado do placar. O placar muda algumas dezenas de vezes por partida, então
trocar o bitmap é operação trivial.

**Por que não VisionCamera.** Nem a v4 nem a v5 escrevem o overlay no arquivo: o
`Recorder` grava os frames crus da câmera, e o `FrameRenderer` da v5 desenha numa
*view*. E ela disputaria a câmera com o encoder de streaming.

**Por que não ffmpeg no aparelho.** O FFmpegKit foi aposentado em janeiro/2025 e
os binários saíram dos repositórios em abril/2025. O que restou no npm é uma
dúzia de forks pessoais sem sucessor claro, e o modo de falha é cruel:
`npm install` funciona, o build nativo quebra.

**Publicar num endereço único.** O app manda para um endereço RTMP estático e a
distribuição (YouTube, Instagram) fica com um serviço de restream. Três razões:
o app não precisa saber que Instagram existe; a chave do Instagram é
**temporária** (expira a cada live) e esse atrito não pode cair na beira da
quadra; e internet de ginásio não aguenta dois uploads simultâneos.

**Máscara/plugin dentro do Instagram não é opção.** O Meta Spark foi desligado
em 14/01/2025 e os efeitos de terceiros foram removidos do Instagram.

## O contrato com o convoca.net

O backend é outro repositório (`P:\pessoal\AVF`, Supabase, schema `rede`). **Este
projeto lê `rede` por função e nunca escreve migration nele** — as migrations de
lá vivem fazendo `create or replace` nos mesmos objetos e são aplicadas à mão, e
duas sequências não colidem por número, colidem por ordem.

Duas RPCs públicas, sem cabeçalho (a raiz do PostgREST devolve 401 para anon):

- **`public.sumula_status(p_sumula)`** — estado, formato, equipes, placar
  corrente, sets com `encerrado`, `versao`, `atualizado_em`.
- **`public.sumula_timeline(p_sumula)`** — rallies já filtrados pelo cursor, com
  placar corrente e saque, mais `saque_inicial` por set. Fonte de produção do
  vídeo. Devolve `null` para súmula inexistente.

Formato, equipes e `encerrado` ficam **só** no status — a `sumula_timeline` não
duplica de propósito.

A ficha de abertura (escalações e arbitragem) lê tabelas cruas com
`Accept-Profile: rede`, porque a migration 090 tornou a súmula inteira pública.
Ver a dívida documentada em `src/data/abertura.ts`.

### Armadilhas mapeadas

Cada uma custou uma rodada de investigação. Estão detalhadas nos comentários dos
arquivos, mas em resumo:

- **Não existe estado "antes do apito".** `rede.sumulas.estado` só tem `em_jogo`
  e `encerrada`, e a súmula **nasce** `em_jogo`. O apito inicial é o primeiro
  rally, não uma transição de estado.
- **`atualizado_em` não é a hora do último ponto.** Desde a migration 125 é a
  hora da última escrita de qualquer tipo — cartão, substituição, encerramento.
  A hora do ponto está em `sumula_rallies.criado_em`.
- **Súmulas anteriores à 125 escondem a diferença acima**, porque o backfill
  preencheu `atualizado_em` com a hora do último rally. Testar só nelas não
  revela o problema.
- **`versao` é contador de escritas**, guardado e mantido por gatilho (125).
  Comparar com `!==`, nunca com `>` — é selo de mudança, não sequência sem
  buracos.
- **Desfazer não apaga rally.** `sumula_cursor` só recua `rallies_ativos`; a
  cauda é apagada no `sumula_ponto` seguinte. Daí o filtro do cursor, que hoje
  vive na `sumula_timeline` e não mais aqui.

## Schema próprio: `gravacao`

Em `supabase/gravacao/`, numeração a partir de 001. É onde o app pode escrever.
Encosta em terreno compartilhado só por três funções em `public`, prefixadas
`gravacao_`, porque o PostgREST deste projeto expõe apenas
`public, graphql_public, rede` — sem os atalhos o schema seria inalcançável.

As tabelas ficam com RLS ligada e sem policy: invisíveis pela API. Todo acesso
passa pelas funções, que exigem o código da sessão (128 bits, entregues por QR,
validade de 12h).

## Ferramentas

```bash
npm test           # 19 testes (relógio, timeline, contrato de carimbo)
npm run typecheck
npm run probe      # acompanha uma súmula ao vivo, imprime os eventos
npm run abertura   # imprime a ficha de abertura (escalações, arbitragem)
npm run burn:demo  # prova o pipeline de burn com vídeo sintético
```

Pós-jogo, reconstruir a timeline e queimar um vídeo já gravado:

```bash
npx tsx tools/refazer.ts --link <url|uuid> --t0 <iso> --video jogo.mp4 --out final.mp4
```

Esse caminho deixou de ser o principal, mas continua útil para equipes que
gravaram por conta e querem inserir o placar sincronizando o início.

## Requisitos de ambiente

- Node 20.19+ (Expo SDK 57)
- `ffmpeg` e `ffprobe` no PATH, para o burn no desktop
- Conta Expo, para gerar o build (`@convoca.net/convoca`)
