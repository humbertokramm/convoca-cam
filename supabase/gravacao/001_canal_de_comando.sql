-- Migration 001 (schema `gravacao`) — o canal de comando do controle remoto
-- Rode no Supabase > SQL Editor > Run. (idempotente)
--
-- ESCOPO. Este arquivo NÃO toca em `rede`. Cria um schema próprio, com
-- numeração própria, exatamente pela razão que o outro lado apontou: duas
-- sequências de migration aplicadas à mão não colidem por número, colidem por
-- ordem, e a última a rodar apaga a outra em silêncio. Objetos disjuntos são a
-- única fronteira real.
--
-- A ÚNICA COISA QUE ENCOSTA EM TERRENO COMPARTILHADO são três funções em
-- `public`, todas prefixadas `gravacao_`. Elas moram lá pela lição da 093: o
-- PostgREST só procura fora de `public` quando o pedido manda
-- `Accept-Profile`, e a página do controle remoto é um link aberto no
-- navegador do celular — link não manda cabeçalho. O prefixo mantém os nomes
-- disjuntos dos de `rede`.
--
-- POR QUE UMA TABELA E NÃO REALTIME. O comando precisa sobreviver a um
-- segundo sem sinal. Um websocket entrega ou não entrega; uma linha fica lá
-- esperando o app voltar. Para "começar a gravar" isso é a diferença entre
-- perder e não perder o começo da partida.
--
-- SEGURANÇA. As tabelas ficam com RLS ligada e SEM policy alguma, e o anon não
-- recebe `usage` no schema — ou seja, são invisíveis pela API. Todo acesso
-- passa pelas três funções `security definer`, que exigem o código da sessão.
-- O código é o segredo: 128 bits gerados pelo app, entregues por QR code, com
-- validade de 12 horas. Não é digitado por ninguém, então pode ser longo.
--
-- TODAS AS TRÊS DEVOLVEM `agora`. É a hora do Postgres no instante da chamada,
-- e existe para o app ancorar a timeline no relógio do SERVIDOR em vez de no do
-- aparelho. `sumula_rallies.criado_em` é `now()` do Postgres; se o início da
-- gravação for marcado pelo relógio do celular, o deslocamento da timeline
-- passa a ser a deriva entre os dois relógios. Celular adiantado não é hipótese
-- aqui — o app web já precisou tratar PGRST303 / "issued at future" com estes
-- mesmos aparelhos.
--
-- O header `Date` de qualquer resposta do PostgREST resolveria a deriva de
-- minutos, mas tem granularidade de 1 segundo. `agora` é mais fino, e o app já
-- chama estas funções em polling — sai de graça.
--
-- É `clock_timestamp()` e NÃO `now()`. `now()` é `transaction_timestamp()`:
-- congela no início da transação. Isso não quebraria o estimador de intervalo
-- (o início da transação está dentro de [envio, recebimento], então os limites
-- seguem válidos), mas afrouxaria o cerco pelo tempo que a transação levou
-- antes de avaliar a expressão — e em `gravacao_proximo_comando` há um select
-- e um update antes. `clock_timestamp()` é o único que lê o relógio de parede
-- no instante da chamada, que é o que o cliente supõe ao registrar a amostra.
-- As demais horas do arquivo seguem em `now()` de propósito: `expira_em`, as
-- comparações de validade e `entregue_em` devem ser coerentes entre si dentro
-- da mesma chamada.

create schema if not exists gravacao;

-- Deliberadamente NÃO se concede `usage` em `gravacao` para anon: o acesso é
-- só pelas funções abaixo, que rodam como dono.

-- ---------------------------------------------------------------- 1) tabelas

create table if not exists gravacao.sessoes (
  id        uuid primary key default gen_random_uuid(),
  -- Segredo compartilhado entre o app e a página do remoto.
  codigo    text not null unique,
  -- Referência SOLTA para a súmula. Sem foreign key de propósito: `rede` não é
  -- meu, e uma FK aqui criaria dependência de ordem entre as duas sequências
  -- de migration — justamente o que este schema existe para evitar.
  sumula_id uuid,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '12 hours'
);
alter table gravacao.sessoes enable row level security;

create table if not exists gravacao.comandos (
  id          bigserial primary key,
  sessao_id   uuid not null references gravacao.sessoes(id) on delete cascade,
  acao        text not null,
  criado_em   timestamptz not null default now(),
  -- Nulo enquanto o app ainda não leu.
  entregue_em timestamptz
);
alter table gravacao.comandos enable row level security;

alter table gravacao.comandos drop constraint if exists comandos_acao_ck;
alter table gravacao.comandos add constraint comandos_acao_ck
  check (acao in ('gravar', 'parar'));

create index if not exists idx_comandos_pendentes
  on gravacao.comandos(sessao_id, id desc) where entregue_em is null;

-- ---------------------------------------------------------------- 2) funções

-- Abre (ou reencontra) a sessão. Chamada pelo app ao montar a tela de captura.
create or replace function public.gravacao_abrir_sessao(p_codigo text, p_sumula uuid default null)
returns json language plpgsql security definer set search_path = gravacao, public as $fn$
declare v_id uuid;
begin
  -- O código é a única defesa. Um código curto seria adivinhável por força
  -- bruta, e a API não tem throttle por chamada.
  if length(coalesce(p_codigo, '')) < 20 then
    raise exception 'Código de sessão curto demais (mínimo 20 caracteres).';
  end if;

  -- Faxina oportunista: sem isto as sessões de todos os jogos ficam para
  -- sempre, e não há cron aqui.
  delete from gravacao.sessoes where expira_em < now() - interval '7 days';

  insert into gravacao.sessoes (codigo, sumula_id)
  values (p_codigo, p_sumula)
  on conflict (codigo) do update
    set sumula_id = coalesce(excluded.sumula_id, sessoes.sumula_id)
  returning id into v_id;

  return json_build_object('sessao_id', v_id, 'codigo', p_codigo, 'agora', clock_timestamp());
end $fn$;

-- Envia um comando. Chamada pela página do controle remoto.
create or replace function public.gravacao_enviar_comando(p_codigo text, p_acao text)
returns json language plpgsql security definer set search_path = gravacao, public as $fn$
declare v_sessao uuid; v_id bigint;
begin
  if p_acao not in ('gravar', 'parar') then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  select id into v_sessao from gravacao.sessoes
   where codigo = p_codigo and expira_em > now();
  if v_sessao is null then
    raise exception 'Sessão inválida ou expirada.';
  end if;

  insert into gravacao.comandos (sessao_id, acao)
  values (v_sessao, p_acao)
  returning id into v_id;

  return json_build_object('comando_id', v_id, 'acao', p_acao, 'agora', clock_timestamp());
end $fn$;

-- Busca o próximo comando. Chamada pelo app em polling.
create or replace function public.gravacao_proximo_comando(p_codigo text)
returns json language plpgsql security definer set search_path = gravacao, public as $fn$
declare v_sessao uuid; v_c gravacao.comandos;
begin
  select id into v_sessao from gravacao.sessoes
   where codigo = p_codigo and expira_em > now();
  if v_sessao is null then
    raise exception 'Sessão inválida ou expirada.';
  end if;

  -- Só o comando MAIS RECENTE importa. Se o app ficou 30s sem sinal e nesse
  -- tempo chegaram 'gravar' e depois 'parar', obedecer os dois em sequência
  -- daria uma gravação de lixo; obedecer o último é o que a pessoa quis.
  select * into v_c from gravacao.comandos
   where sessao_id = v_sessao and entregue_em is null
   order by id desc limit 1
   for update skip locked;

  if v_c.id is null then
    return json_build_object('acao', null, 'agora', clock_timestamp());
  end if;

  -- Marca o escolhido E os atrasados: o backlog é colapsado, não enfileirado.
  update gravacao.comandos set entregue_em = now()
   where sessao_id = v_sessao and entregue_em is null and id <= v_c.id;

  return json_build_object('acao', v_c.acao, 'comando_id', v_c.id,
                           'criado_em', v_c.criado_em, 'agora', clock_timestamp());
end $fn$;

-- ----------------------------------------------------------------- 3) grants

grant execute on function public.gravacao_abrir_sessao(text, uuid)   to anon, authenticated;
grant execute on function public.gravacao_enviar_comando(text, text) to anon, authenticated;
grant execute on function public.gravacao_proximo_comando(text)      to anon, authenticated;
