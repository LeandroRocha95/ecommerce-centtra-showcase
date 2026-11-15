import { describe, expect, it } from "vitest";

import {
  datasDaEntrega,
  ddmm,
  fraseChegaAte,
  inicioDaProducao,
  lerPrazosDeProducao,
  portaDaPeca,
  producaoDoPedido,
  producaoPelosPrazosDaLoja,
  somarDiasUteis,
  type DataCivil,
  type PrazosDeProducao,
} from "./prazos";

// Os instantes são em UTC; a loja vive em America/Sao_Paulo (UTC-3, sem horário de verão).
// 10/11/2026 é uma TERÇA-FEIRA; 13/11 sexta; 14 e 15 fim de semana.
const terca10h = "2026-11-10T13:00:00Z"; // 10h na loja
const terca17h = "2026-11-10T20:00:00Z"; // 17h na loja
const sexta18h = "2026-11-13T21:00:00Z"; // 18h na loja
const sabado9h = "2026-11-14T12:00:00Z"; // 9h na loja
const terca23hNaLoja = "2026-11-11T02:30:00Z"; // já é quarta em UTC, ainda terça 23h30 na loja

const PRAZOS: PrazosDeProducao = { pronta: 2, lisa: 5, doZero: 10, monte: 7, corte: "14:00" };

const dia = (ano: number, mes: number, d: number): DataCivil => ({ ano, mes, dia: d });

describe("somarDiasUteis — segunda a sexta", () => {
  it("pula o fim de semana", () => {
    expect(somarDiasUteis(dia(2026, 11, 13), 1)).toEqual(dia(2026, 11, 16));
    expect(somarDiasUteis(dia(2026, 11, 10), 5)).toEqual(dia(2026, 11, 17));
  });
  it("zero dias é o próprio dia", () => {
    expect(somarDiasUteis(dia(2026, 11, 10), 0)).toEqual(dia(2026, 11, 10));
  });
  it("vira o mês e o ano", () => {
    expect(somarDiasUteis(dia(2026, 12, 31), 1)).toEqual(dia(2027, 1, 1));
  });
  it("aceita outra régua de dia útil (o ponto de extensão dos feriados)", () => {
    const semO16 = (d: DataCivil) => !(d.mes === 11 && d.dia === 16) && ![0, 6].includes(new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay());
    expect(somarDiasUteis(dia(2026, 11, 13), 1, semO16)).toEqual(dia(2026, 11, 17));
  });
});

describe("inicioDaProducao — o horário de corte", () => {
  it("antes do corte conta o próprio dia", () => {
    expect(inicioDaProducao(terca10h, "14:00")).toEqual(dia(2026, 11, 10));
  });
  it("depois do corte conta do próximo dia útil", () => {
    expect(inicioDaProducao(terca17h, "14:00")).toEqual(dia(2026, 11, 11));
  });
  it("sexta depois do corte começa na segunda", () => {
    expect(inicioDaProducao(sexta18h, "14:00")).toEqual(dia(2026, 11, 16));
  });
  it("fim de semana começa na segunda, com ou sem corte", () => {
    expect(inicioDaProducao(sabado9h, "14:00")).toEqual(dia(2026, 11, 16));
    expect(inicioDaProducao(sabado9h, null)).toEqual(dia(2026, 11, 16));
  });
  it("sem corte, o dia útil do pagamento conta", () => {
    expect(inicioDaProducao(terca17h, null)).toEqual(dia(2026, 11, 10));
  });
  it("o dia é o da LOJA, não o de UTC", () => {
    expect(inicioDaProducao(terca23hNaLoja, null)).toEqual(dia(2026, 11, 10));
    expect(inicioDaProducao(terca23hNaLoja, "14:00")).toEqual(dia(2026, 11, 11));
  });
  it("exatamente no corte ainda conta o dia", () => {
    expect(inicioDaProducao("2026-11-10T17:00:00Z", "14:00")).toEqual(dia(2026, 11, 10));
  });
});

describe("producaoDoPedido — o MAIOR prazo entre os itens", () => {
  it("vale o maior", () => {
    expect(producaoDoPedido(["pronta", "doZero"], PRAZOS)).toEqual({ dias: 10, aPartirDaArte: false, corte: "14:00" });
  });
  it("Monte a sua conta da aprovação da arte", () => {
    expect(producaoDoPedido(["pronta", "monte"], PRAZOS)).toEqual({ dias: 7, aPartirDaArte: true, corte: "14:00" });
  });
  it("sem prazo nenhum configurado é o comportamento de hoje (null)", () => {
    expect(producaoDoPedido(["pronta", "doZero"], lerPrazosDeProducao({}))).toBeNull();
  });
  it("porta sem prazo configurado conta zero", () => {
    const so = lerPrazosDeProducao({ do_zero: 10 });
    expect(producaoDoPedido(["pronta"], so)).toEqual({ dias: 0, aPartirDaArte: false, corte: null });
  });
  it("sem itens, nada", () => {
    expect(producaoDoPedido([], PRAZOS)).toBeNull();
  });
});

describe("portaDaPeca", () => {
  it("variante com saldo disponível é peça pronta", () => {
    expect(portaDaPeca({ natureza: "variante", disponivel: 3, quantidade: 2 })).toBe("pronta");
  });
  it("variante sem saldo bastante é feita do zero (sob encomenda)", () => {
    expect(portaDaPeca({ natureza: "variante", disponivel: 1, quantidade: 2 })).toBe("doZero");
    expect(portaDaPeca({ natureza: "variante", disponivel: null, quantidade: 1 })).toBe("doZero");
  });
  it("peça personalizada é Monte a sua", () => {
    expect(portaDaPeca({ natureza: "personalizado", disponivel: null, quantidade: 1 })).toBe("monte");
  });
});

describe("datasDaEntrega — pagamento + produção + frete", () => {
  it("terça 10h, do zero (10) + frete 6: pronto 24/11, chega 02/12", () => {
    const producao = producaoDoPedido(["doZero"], PRAZOS);
    const datas = datasDaEntrega({ desde: terca10h, producao, prazoFreteDias: 6 })!;
    expect(ddmm(datas.prontoAte!)).toBe("24/11");
    expect(ddmm(datas.chegaAte)).toBe("02/12");
  });
  it("depois do corte empurra um dia útil", () => {
    const producao = producaoDoPedido(["doZero"], PRAZOS);
    const datas = datasDaEntrega({ desde: terca17h, producao, prazoFreteDias: 6 })!;
    expect(ddmm(datas.prontoAte!)).toBe("25/11");
    expect(ddmm(datas.chegaAte)).toBe("03/12");
  });
  it("sem prazos configurados: só o frete, como hoje", () => {
    const datas = datasDaEntrega({ desde: terca10h, producao: null, prazoFreteDias: 6 })!;
    expect(datas.prontoAte).toBeNull();
    expect(ddmm(datas.chegaAte)).toBe("18/11");
  });
  it("data ilegível ou prazo torto: null", () => {
    expect(datasDaEntrega({ desde: "ontem", producao: null, prazoFreteDias: 6 })).toBeNull();
    expect(datasDaEntrega({ desde: terca10h, producao: null, prazoFreteDias: -1 })).toBeNull();
  });
});

describe("fraseChegaAte", () => {
  it("diz a data", () => {
    expect(fraseChegaAte(dia(2026, 12, 2), false)).toBe("Chega até 02/12");
  });
  it("Monte a sua diz de onde conta", () => {
    expect(fraseChegaAte(dia(2026, 12, 2), true)).toBe("Chega até 02/12, a partir da aprovação da prova de arte");
  });
});

describe("lerPrazosDeProducao — sem confiar na forma", () => {
  it("lê o que veio do banco", () => {
    expect(lerPrazosDeProducao({ pronta: 2, lisa: 5, do_zero: 10, monte: 7, corte: "14:00" })).toEqual(PRAZOS);
  });
  it("descarta o que não é inteiro de 0 a 90 ou horário HH:MM", () => {
    expect(lerPrazosDeProducao({ pronta: -1, lisa: 2.5, do_zero: "10", monte: 91, corte: "25:00" })).toEqual({
      pronta: null,
      lisa: null,
      doZero: null,
      monte: null,
      corte: null,
    });
    expect(lerPrazosDeProducao(null)).toEqual({ pronta: null, lisa: null, doZero: null, monte: null, corte: null });
  });
});

describe("producaoPelosPrazosDaLoja — pedido que não gravou a produção", () => {
  const LOJA = lerPrazosDeProducao({ pronta: 3, lisa: 3, do_zero: 5, monte: 5 });
  it("peça do catálogo conta como feita do zero; Monte a sua, pela arte", () => {
    expect(producaoPelosPrazosDaLoja(["variante"], LOJA)).toEqual({ dias: 5, aPartirDaArte: false, corte: null });
    expect(producaoPelosPrazosDaLoja(["variante", "personalizado"], LOJA)).toEqual({ dias: 5, aPartirDaArte: true, corte: null });
  });
  it("sem itens legíveis conta uma peça; loja sem prazos, nada", () => {
    expect(producaoPelosPrazosDaLoja([], LOJA)?.dias).toBe(5);
    expect(producaoPelosPrazosDaLoja(["variante"], null)).toBeNull();
    expect(producaoPelosPrazosDaLoja(["variante"], lerPrazosDeProducao({}))).toBeNull();
  });
});
