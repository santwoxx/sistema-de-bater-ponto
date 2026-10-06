// Datas são sempre gravadas como instantes absolutos (UTC). A "data local"
// (dia em que a marcação conta) é calculada no fuso horário da empresa,
// porque o servidor roda em UTC e o Brasil tem quatro fusos.

export interface PartesData {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

export function partesNoFuso(data: Date, fuso: string): PartesData {
  const partes: Record<string, number> = {};
  for (const parte of formatador(fuso).formatToParts(data)) {
    if (parte.type !== "literal") partes[parte.type] = Number(parte.value);
  }
  return {
    ano: partes.year,
    mes: partes.month,
    dia: partes.day,
    hora: partes.hour % 24,
    minuto: partes.minute,
    segundo: partes.second,
  };
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

export function dataLocal(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  return `${p.ano}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)}`;
}

export function horaLocal(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  return `${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}:${doisDigitos(p.segundo)}`;
}

function deslocamentoMs(data: Date, fuso: string): number {
  const p = partesNoFuso(data, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - (data.getTime() - data.getMilliseconds());
}

// Converte "data + hora de parede" no fuso da empresa para o instante UTC.
export function localParaUtc(dataISO: string, hora: string, fuso: string): Date {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const [h, m] = hora.split(":").map(Number);
  const palpite = Date.UTC(ano, mes - 1, dia, h, m, 0);
  const primeiro = deslocamentoMs(new Date(palpite), fuso);
  let utc = palpite - primeiro;
  const segundo = deslocamentoMs(new Date(utc), fuso);
  if (segundo !== primeiro) utc = palpite - segundo;
  return new Date(utc);
}
