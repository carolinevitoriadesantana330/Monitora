/* ============================================================
   CONFIGURAÇÃO DO SUPABASE
   Troque pelos dados do seu projeto em:
   Supabase > Project Settings > API
   ============================================================ */
const SUPABASE_URL = 'https://zxepgwlrhcqddgiopnsh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_krLbkRQAASCCZrIGyUTpeA_GNgtluwc';

let sb = null;
try {
  if (window.supabase && SUPABASE_URL.indexOf('SEU-PROJETO') === -1) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.warn('Supabase ainda não configurado:', e);
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                'agosto','setembro','outubro','novembro','dezembro'];

const pad = n => String(n).padStart(2, '0');

const horaAtual = (date = new Date()) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const dataAtual = (date = new Date()) =>
  `${DIAS[date.getDay()]}, ${date.getDate()} de ${MESES[date.getMonth()]}`;

function formatarDuracao(minutosTotais) {
  if (minutosTotais === null || minutosTotais === undefined || isNaN(minutosTotais)) return '—';
  const h = Math.floor(minutosTotais / 60);
  const m = Math.round(minutosTotais % 60);
  return h === 0 ? `${m} min` : `${h}h ${pad(m)} min`;
}

function corPelaEspera(minutos) {
  if (minutos === null || minutos === undefined) return '';
  if (minutos < 60) return '';
  if (minutos < 90) return 'wait-yellow';
  return 'wait-red';
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem('monitora_upa_device_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem('monitora_upa_device_id', id);
  }
  return id;
}

function parseHoraParaData(textoHHMM, base = new Date()) {
  const [hh, mm] = textoHHMM.split(':').map(Number);
  const d = new Date(base);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/* ============================================================
   RELÓGIO (atualiza em todas as telas que têm data-clock-time)
   ============================================================ */
function atualizarRelogios() {
  const agora = new Date();
  document.querySelectorAll('[data-clock-time]').forEach(el => el.textContent = horaAtual(agora));
  document.querySelectorAll('[data-clock-date]').forEach(el => el.textContent = dataAtual(agora));
}
atualizarRelogios();
setInterval(atualizarRelogios, 1000);

/* ============================================================
   NAVEGAÇÃO ENTRE TELAS
   ============================================================ */
function mostrarTela(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
const state = {
  deviceId: getOrCreateDeviceId(),
  upaSelecionada: null,
  upasCache: [],
  ordenarPor: 'tempo',
  posicaoUsuario: null,
};

/* ============================================================
   TELA INICIAL — LISTA DE UPAS
   ============================================================ */
async function obterLocalizacao() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000 }
    );
  });
}

async function carregarUpas() {
  const lista = document.getElementById('upa-list');

  if (!sb) {
    lista.innerHTML = '<p class="loading-msg">Configure SUPABASE_URL e SUPABASE_ANON_KEY em app.js para carregar as UPAs.</p>';
    return;
  }

  lista.innerHTML = '<p class="loading-msg">Carregando UPAs...</p>';

  const { data: upas, error } = await sb.from('upas').select('*');
  if (error) {
    lista.innerHTML = '<p class="loading-msg">Erro ao carregar UPAs. Veja o console.</p>';
    console.error(error);
    return;
  }

  const desde = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data: atendimentos } = await sb
    .from('atendimentos')
    .select('upa_id, tempo_permanencia_minutos')
    .eq('status', 'finalizado')
    .gte('criado_em', desde);

  const temposPorUpa = {};
  (atendimentos || []).forEach(a => {
    if (a.tempo_permanencia_minutos === null) return;
    (temposPorUpa[a.upa_id] ??= []).push(a.tempo_permanencia_minutos);
  });

  const upasComDados = (upas || []).map(u => {
    const tempos = temposPorUpa[u.id] || [];
    const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
    const distanciaKm = state.posicaoUsuario
      ? haversineKm(state.posicaoUsuario.lat, state.posicaoUsuario.lng, u.latitude, u.longitude)
      : null;
    return { ...u, tempoMedio, distanciaKm };
  });

  state.upasCache = upasComDados;
  renderizarLista(upasComDados);
}

function renderizarLista(upas) {
  const ordenadas = [...upas].sort((a, b) => {
    if (state.ordenarPor === 'distancia') {
      if (a.distanciaKm === null) return 1;
      if (b.distanciaKm === null) return -1;
      return a.distanciaKm - b.distanciaKm;
    }
    if (a.tempoMedio === null) return 1;
    if (b.tempoMedio === null) return -1;
    return a.tempoMedio - b.tempoMedio;
  });

  const lista = document.getElementById('upa-list');
  lista.innerHTML = '';

  if (ordenadas.length === 0) {
    lista.innerHTML = '<p class="loading-msg">Nenhuma UPA cadastrada ainda. Rode o supabase-schema.sql.</p>';
    return;
  }

  ordenadas.forEach(u => {
    const corClasse = corPelaEspera(u.tempoMedio);
    const card = document.createElement('div');
    card.className = `upa-card ${corClasse}`;
    card.innerHTML = `
      <div>
        <div class="upa-name">${u.nome}</div>
        <div class="upa-distance">${u.distanciaKm !== null ? u.distanciaKm.toFixed(1).replace('.', ',') + ' km' : 'distância indisponível'}</div>
      </div>
      <div class="upa-wait ${corClasse}">${formatarDuracao(u.tempoMedio)}</div>
    `;
    card.addEventListener('click', () => iniciarCheckin(u));
    lista.appendChild(card);
  });
}

document.querySelectorAll('.pill-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.ordenarPor = btn.dataset.sort;
    renderizarLista(state.upasCache);
  });
});

/* ============================================================
   TELA DE CHECK-IN (chegada)
   ============================================================ */
let respostaSelecionada = null;

function iniciarCheckin(upa) {
  state.upaSelecionada = upa;
  respostaSelecionada = null;

  document.getElementById('checkin-upa-nome').textContent = upa.nome;
  const campoHora = document.getElementById('checkin-time');
  campoHora.textContent = horaAtual();
  campoHora.contentEditable = 'false';

  document.querySelectorAll('#screen-checkin [data-response]').forEach(b => b.classList.remove('selected'));
  mostrarTela('screen-checkin');
}

document.querySelectorAll('#screen-checkin [data-response]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-checkin [data-response]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    respostaSelecionada = btn.dataset.response;
  });
});

document.getElementById('btn-corrigir-chegada').addEventListener('click', () => {
  const campo = document.getElementById('checkin-time');
  campo.contentEditable = 'true';
  campo.focus();
});

document.getElementById('btn-confirmar-chegada').addEventListener('click', async () => {
  if (!respostaSelecionada) {
    alert('Toque em "Sim", "Não" ou "Sou funcionário" antes de confirmar.');
    return;
  }
  if (respostaSelecionada === 'nao') {
    mostrarTela('screen-home');
    return;
  }
  if (respostaSelecionada === 'funcionario') {
    alert('Obrigado! Check-ins de funcionários não entram no tempo médio.');
    mostrarTela('screen-home');
    return;
  }
  if (!state.upaSelecionada) {
    alert('Selecione uma UPA na tela inicial primeiro.');
    return;
  }
  if (!sb) {
    alert('Configure o Supabase em app.js para salvar o check-in.');
    return;
  }

  const horario = parseHoraParaData(document.getElementById('checkin-time').textContent);

  const { data, error } = await sb.from('atendimentos').insert({
    upa_id: state.upaSelecionada.id,
    dispositivo_id: state.deviceId,
    horario_chegada: horario.toISOString(),
    status: 'em_andamento'
  }).select().single();

  if (error) {
    alert('Não foi possível registrar a chegada.');
    console.error(error);
    return;
  }

  localStorage.setItem('monitora_upa_atendimento_ativo', JSON.stringify({
    id: data.id,
    upaId: state.upaSelecionada.id,
    upaNome: state.upaSelecionada.nome,
    horarioChegada: horario.toISOString()
  }));

  alert('Chegada registrada! Toque em "Check-out" quando for embora.');
  mostrarTela('screen-home');
});

/* ============================================================
   TELA DE CHECK-OUT (saída)
   ============================================================ */
function carregarCheckout() {
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');
  if (!ativoStr) {
    alert('Nenhum atendimento em andamento. Faça o check-in primeiro.');
    mostrarTela('screen-home');
    return;
  }

  const ativo = JSON.parse(ativoStr);
  const chegada = new Date(ativo.horarioChegada);
  const agora = new Date();
  const minutos = Math.max(0, Math.round((agora - chegada) / 60000));

  document.getElementById('checkout-upa-nome').textContent = ativo.upaNome;
  document.getElementById('permanencia-valor').textContent = formatarDuracao(minutos);

  const campoHora = document.getElementById('checkout-time');
  campoHora.textContent = horaAtual(agora);
  campoHora.contentEditable = 'false';

  mostrarTela('screen-checkout');
}

document.getElementById('btn-corrigir-saida').addEventListener('click', () => {
  const campo = document.getElementById('checkout-time');
  campo.contentEditable = 'true';
  campo.focus();
});

async function finalizarAtendimento(status) {
  const ativoStr = localStorage.getItem('monitora_upa_atendimento_ativo');
  if (!ativoStr) { mostrarTela('screen-home'); return; }
  if (!sb) {
    alert('Configure o Supabase em app.js para salvar a saída.');
    return;
  }

  const ativo = JSON.parse(ativoStr);
  const saida = parseHoraParaData(document.getElementById('checkout-time').textContent);
  const chegada = new Date(ativo.horarioChegada);
  const minutos = Math.max(0, Math.round((saida - chegada) / 60000));

  const { error } = await sb.from('atendimentos').update({
    horario_saida: saida.toISOString(),
    tempo_permanencia_minutos: minutos,
    status
  }).eq('id', ativo.id);

  if (error) {
    alert('Não foi possível registrar a saída.');
    console.error(error);
    return;
  }

  localStorage.removeItem('monitora_upa_atendimento_ativo');
  mostrarTela('screen-home');
  carregarUpas();
}

document.getElementById('btn-finalizar').addEventListener('click', () => finalizarAtendimento('finalizado'));
document.getElementById('btn-desisti').addEventListener('click', () => finalizarAtendimento('desistiu'));

/* ============================================================
   BARRA DE PROTÓTIPO (navegação manual entre as 3 telas)
   ============================================================ */
document.querySelectorAll('.proto-nav [data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    const alvo = btn.dataset.goto;
    if (alvo === 'screen-checkin') {
      const upa = state.upaSelecionada || state.upasCache[0];
      if (upa) iniciarCheckin(upa);
      else alert('Nenhuma UPA carregada ainda. Verifique o Supabase.');
      return;
    }
    if (alvo === 'screen-checkout') {
      carregarCheckout();
      return;
    }
    mostrarTela(alvo);
  });
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
(async function init() {
  mostrarTela('screen-home');
  state.posicaoUsuario = await obterLocalizacao();
  await carregarUpas();
})();