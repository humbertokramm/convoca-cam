# Plano

O que falta, em ordem de prioridade. A ordem é por **risco de perder o jogo**,
não por vistosidade.

O que já funciona está no [README](../README.md); o porquê das escolhas está em
[DECISOES.md](DECISOES.md).

---

## 1. Gravação em segmentos — RISCO DE PERDER A PARTIDA INTEIRA

**Por que é o primeiro.** O MP4 guarda o índice (`moov`) no FIM do arquivo,
escrito quando a gravação para. Se o processo morrer antes — bateria, o sistema
matando o app, travamento — **o arquivo fica sem índice e não abre em player
nenhum**. Não é vídeo parcial: é vídeo perdido.

Numa partida de 90 minutos isso não é hipótese.

**A RootEncoder 2.6.0 não tem segmentação nativa.** Conferido no fonte: sem
`maxDuration`, sem `maxFileSize`, sem `RecorderSettings` (esses vieram na 2.8,
que é a versão incompatível com o Kotlin do Expo — ver DECISOES 6).

Então é implementado aqui: temporizador no nativo, `stopRecord` + `startRecord`
no arquivo seguinte, e `requestKeyframe()` para o segmento novo começar com
quadro-chave em vez de esperar o próximo natural.

Custo conhecido: perde-se uma fração de segundo na costura entre segmentos.
Contra perder 90 minutos, é troca fácil.

**Depois:** juntar os segmentos. Concatenar MP4 sem recodificar exige
`MediaExtractor` + `MediaMuxer` (uns 150 linhas) — dá para fazer no aparelho,
sem ffmpeg. Se a junção falhar, os segmentos continuam lá, o que é a ordem
certa de dependência.

---

## 2. Publicar na galeria

Hoje o vídeo grava em `Android/data/net.convoca.cam/files/Movies/`, que é área
privada do app e **não aparece na galeria**. Foi escolha deliberada — enquanto
grava, o arquivo está incompleto, e publicar de imediato colocaria um vídeo
quebrado lá — mas o passo de publicar **quando a gravação para** ficou sem
implementar.

Usar `expo-media-library` (já instalado) no `stopRecord`.

---

## 3. Eventos da súmula na tela

Pedido do dono do projeto. Boa parte do dado já está na mão:

| | de onde vem | estado |
|---|---|---|
| Quem está no saque | `sumula_timeline.rallies[].saque` | **já aparece** no placar |
| Escalação no início de cada set | `sumula_atletas` (leitura da abertura) | dado pronto, falta desenhar |
| Penalizações e cartões | `rede.sumula_sancoes` — **já é público** (grant a anon) | falta ler e desenhar |

A escalação no início do set é a que mais muda o vídeo: é uma tela cheia por
set, não uma tarja.

---

## 4. Logos de patrocinador

**Alternando no mesmo lugar, a cada 5 segundos**, na diagonal oposta ao placar.

### PNG com transparência: sim, e por um caminho melhor que o SVG

Os logos NÃO entram no SVG do placar. Entram num **filtro de GL próprio**
(`ImageObjectFilterRender` separado), por três razões:

1. **Transparência garantida.** `BitmapFactory` decodifica PNG com alfa em
   `ARGB_8888`, e o filtro compõe em OpenGL. Não depende de o rasterizador de
   SVG entender `<image>` — e o `androidsvg` parou em 2019, com suporte a
   imagem embutida que não consegui confirmar na fonte.
2. **Posição independente.** O filtro tem `setScale`/`setPosition` próprios,
   então patrocinador e placar se movem sem se atrapalhar.
3. **A troca a cada 5s fica barata.** É `setImage(outroBitmap)` num
   temporizador. Sem rasterizar SVG de novo, sem tocar no grafo de GL.

---

## 5. Posição do placar configurável

Hoje é fixa no código (canto inferior esquerdo no 16:9, topo no 9:16). Virar
configurável é direto — o layout já calcula tudo a partir de duas âncoras.

---

## 6. Logo dos times no placar e na escalação

Miniatura dentro da tarja e versão maior junto com as escalações.

### O que já existe, e o que falta

`rede.clubes.logo_path` **existe** desde a migration 031, e o bucket `clubes` é
**público** com política de leitura (`for select using (bucket_id = 'clubes')`).
`sumula_equipes` já expõe `clube_id` e já é legível pelo anon.

O que falta é só ler o caminho: `rede.clubes` recusa o anon com
`permission denied for table clubes`.

**Relatório para o dono do schema** (formato acordado, ver DECISOES 14):

> **Bug/falta em `rede`** — **tabela:** `rede.clubes` · **chamada exata:**
> `GET /rest/v1/clubes?select=id,nome,logo_path` com `Accept-Profile: rede` e
> apikey publishable · **o que voltou:** `42501 permission denied for table
> clubes` · **o que eu esperava e por quê:** ler `logo_path` das duas equipes de
> uma súmula, para pôr o escudo na tarja do placar e na tela de escalação. A
> própria migration 031 argumenta que "marca de organização não é dado pessoal"
> e deixou o bucket `clubes` público — então o caminho do arquivo parece ter a
> mesma natureza do arquivo em si · **dá para contornar do meu lado?** Não.
> `sumula_equipes` me dá `clube_id`, mas nenhuma função pública devolve o
> `logo_path`. Bastaria um grant por coluna
> (`grant select (id, nome, logo_path) on rede.clubes to anon`) ou o campo
> dentro de alguma função de súmula já existente — a segunda opção é melhor se
> houver mais coisa em `clubes` que não deva sair.

### Consequência técnica, decidida junto

O escudo do time fica **dentro** da tarja, então ele acompanha o placar e não
pode ser um filtro independente como o patrocinador. Vai composto no bitmap do
placar: o gerador em TypeScript emite o retângulo onde o escudo cabe, e o
Kotlin desenha o PNG ali depois de rasterizar o SVG.

Isso também significa **baixar e guardar os logos** no aparelho, uma vez por
súmula, antes do jogo — nunca no meio da partida.

---

## Fora de ordem, quando fizer sentido

- **Tecla de volume como disparo** (controle Bluetooth). Escolhido junto com os
  outros dois disparos, mas não implementado. Deve nascer no módulo nativo, que
  já é nosso, e não de biblioteca de terceiro.
- **Página do controle remoto.** O canal no banco está pronto e testado
  (`supabase/gravacao/001`), mas a página que o operador abre não existe.
- **Cartão de abertura** com arbitragem e escalações. Os dados estão prontos e
  verificados; o layout visual não existe.
- **Renomear `src/app`.** O Expo confunde com rota do Expo Router (`app/` é a
  convenção dele) e avisa a cada start. Hoje é inofensivo porque `expo-router`
  não está instalado, mas é armadilha para depois.
- **O mistério do EAS.** Seis builds falharam antes de instalar dependências,
  sem log. Deixou de ser bloqueio porque o build local funciona; segue
  documentado em [PROBLEMA-BUILD.md](PROBLEMA-BUILD.md).
