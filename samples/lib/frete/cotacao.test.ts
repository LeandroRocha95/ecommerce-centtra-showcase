import { describe, expect, it } from "vitest";

import {
  aplicarFreteGratis,
  cepValido,
  descreverOpcao,
  lerCotacao,
  MEDIDAS_DAS_EMBALAGENS,
  medidasDaPeca,
  produtosParaCotacao,
} from "./cotacao";

// A forma da resposta é a que o sandbox do Melhor Envio devolveu em
// 2026-10-25 para Joinville → São Paulo (campos que esta régua lê).
const RESPOSTA = [
  { id: 1, name: "PAC", price: "18.40", delivery_time: 7, company: { name: "Correios" } },
  { id: 2, name: "SEDEX", price: "28.85", delivery_time: 3, company: { name: "Correios" } },
  { id: 3, name: ".Package", price: "19.93", delivery_time: 5, company: { name: "Jadlog" } },
  { id: 4, name: ".Com", price: "15.98", delivery_time: 4, company: { name: "Jadlog" } },
  {
    id: 17,
    name: "Mini Envios",
    error: "Dimensões do objeto ultrapassam o limite da transportadora.",
    company: { name: "Correios" },
  },
];

describe("medidasDaPeca — as embalagens da Léprica", () => {
  it("moletom, baby look e o resto como camiseta básica", () => {
    expect(medidasDaPeca("Moletom canguru · Fé")).toBe(MEDIDAS_DAS_EMBALAGENS.moletom);
    expect(medidasDaPeca("Baby look Fé")).toBe(MEDIDAS_DAS_EMBALAGENS.babyLook);
    expect(medidasDaPeca("Babylook preta")).toBe(MEDIDAS_DAS_EMBALAGENS.babyLook);
    expect(medidasDaPeca("Camiseta preta · Mãe Aparecida")).toBe(MEDIDAS_DAS_EMBALAGENS.camiseta);
    expect(medidasDaPeca("Oversized Fé")).toBe(MEDIDAS_DAS_EMBALAGENS.camiseta);
  });

  it("os números medidos na balança", () => {
    expect(MEDIDAS_DAS_EMBALAGENS.camiseta).toMatchObject({ larguraCm: 25, comprimentoCm: 35, pesoKg: 0.182 });
    expect(MEDIDAS_DAS_EMBALAGENS.babyLook).toMatchObject({ larguraCm: 25, comprimentoCm: 35, pesoKg: 0.133 });
    expect(MEDIDAS_DAS_EMBALAGENS.moletom).toMatchObject({ larguraCm: 35, comprimentoCm: 45, pesoKg: 0.62 });
  });
});

describe("produtosParaCotacao", () => {
  it("uma linha por peça da sacola, com quantidade e valor declarado", () => {
    const produtos = produtosParaCotacao([
      { nome: "Camiseta", quantidade: 3, precoUnitario: 89.9 },
      { nome: "Moletom", quantidade: 1, precoUnitario: 189.9 },
    ]);
    expect(produtos).toEqual([
      { id: "1", width: 25, height: 3, length: 35, weight: 0.182, insurance_value: 89.9, quantity: 3 },
      { id: "2", width: 35, height: 6, length: 45, weight: 0.62, insurance_value: 189.9, quantity: 1 },
    ]);
  });

  it("linha com zero peças não vai para a cotação", () => {
    expect(produtosParaCotacao([{ nome: "Camiseta", quantidade: 0, precoUnitario: 10 }])).toEqual([]);
  });
});

describe("lerCotacao — a resposta crua vira as opções da cliente", () => {
  it("tira o serviço com erro e ordena do mais barato para o mais caro", () => {
    const opcoes = lerCotacao(RESPOSTA);
    expect(opcoes.map((o) => `${o.transportadora} ${o.servico}`)).toEqual([
      "Jadlog .Com",
      "Correios PAC",
      "Jadlog .Package",
      "Correios SEDEX",
    ]);
    expect(opcoes[0]).toEqual({
      servicoId: 4,
      transportadora: "Jadlog",
      servico: ".Com",
      custo: 15.98,
      preco: 15.98,
      prazoDias: 4,
      gratis: false,
    });
  });

  it("usa o preço e o prazo PERSONALIZADOS da conta da loja quando existem", () => {
    const [opcao] = lerCotacao([
      {
        id: 1,
        name: "PAC",
        price: "18.40",
        custom_price: "16.00",
        delivery_time: 7,
        custom_delivery_time: 9,
        company: { name: "Correios" },
      },
    ]);
    expect(opcao).toMatchObject({ custo: 16, preco: 16, prazoDias: 9 });
  });

  it("resposta torta não vira opção — nem preço zero, nem sem nome", () => {
    expect(lerCotacao(null)).toEqual([]);
    expect(lerCotacao({ erro: "x" })).toEqual([]);
    expect(
      lerCotacao([
        { id: 1, name: "PAC", price: "0", delivery_time: 7, company: { name: "Correios" } },
        { id: 2, price: "10", delivery_time: 7, company: { name: "Correios" } },
        { id: "x", name: "PAC", price: "10", delivery_time: 7, company: { name: "Correios" } },
      ]),
    ).toEqual([]);
  });
});

describe("aplicarFreteGratis — a mais barata sai de graça acima do limiar", () => {
  const opcoes = lerCotacao(RESPOSTA);

  it("acima do limiar, só a mais barata fica grátis; as outras mantêm o preço", () => {
    const resultado = aplicarFreteGratis(opcoes, 300, 299);
    expect(resultado[0]).toMatchObject({ servico: ".Com", preco: 0, gratis: true, custo: 15.98 });
    expect(resultado.slice(1).every((o) => !o.gratis && o.preco === o.custo)).toBe(true);
  });

  it("exatamente no limiar também ganha", () => {
    expect(aplicarFreteGratis(opcoes, 299, 299)[0]?.gratis).toBe(true);
  });

  it("abaixo do limiar, ou loja sem limiar, ninguém ganha", () => {
    expect(aplicarFreteGratis(opcoes, 298.99, 299).some((o) => o.gratis)).toBe(false);
    expect(aplicarFreteGratis(opcoes, 1000, null).some((o) => o.gratis)).toBe(false);
  });

  it("não altera a lista de entrada", () => {
    aplicarFreteGratis(opcoes, 300, 299);
    expect(opcoes[0]?.gratis).toBe(false);
  });
});

describe("cepValido e descreverOpcao", () => {
  it("o CEP tem 8 dígitos, com ou sem traço", () => {
    expect(cepValido("89201-000")).toBe("89201000");
    expect(cepValido(" 01310100 ")).toBe("01310100");
    expect(cepValido("1234")).toBeNull();
    expect(cepValido(null)).toBeNull();
  });

  it("a opção se descreve com transportadora, serviço e prazo", () => {
    expect(descreverOpcao({ transportadora: "Correios", servico: "PAC", prazoDias: 7 })).toBe(
      "Correios PAC · 7 dias úteis",
    );
    expect(descreverOpcao({ transportadora: "Correios", servico: "SEDEX", prazoDias: 1 })).toBe(
      "Correios SEDEX · 1 dia útil",
    );
  });
});
