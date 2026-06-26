import assert from "node:assert/strict";
import test from "node:test";
import { extractEventType } from "./extractEventType.js";

test("extractEventType: сводка ПВО Radar Russia — pvo_report", () => {
  const text =
    "С 07:00 до 14:00 силами противоздушной обороны было уничтожено 122 БПЛА "
    + "над территориями Белгородской, Брянской, Калужской, Курской";
  assert.equal(extractEventType(text), "pvo_report");
});

test("extractEventType: «уничтожено N БПЛА» с кириллическим окончанием", () => {
  assert.equal(
    extractEventType("За ночь было уничтожено 45 БПЛА над Ленинградской областью"),
    "pvo_report",
  );
});

test("extractEventType: единичный БПЛА уничтожен — impact", () => {
  assert.equal(
    extractEventType("Г. Пенза, Пензенская область — был уничтожен единичный БПЛА."),
    "impact",
  );
});

test("extractEventType: приготовиться к появлениям — warning", () => {
  assert.equal(
    extractEventType("Сызрань, Самарская область - приготовиться к возможным появлениям БПЛА."),
    "warning",
  );
});

test("extractEventType: приготовиться к сбитию — warning", () => {
  assert.equal(
    extractEventType("Кстово Нижегородская область Приготовиться к сбитию Меры безопасности"),
    "warning",
  );
});

test("extractEventType: работает ПВО — pvo_work", () => {
  assert.equal(
    extractEventType("Кстово,Нижегородская область - работает ПВО по БПЛА"),
    "pvo_work",
  );
});

test("extractEventType: PF «возможно фиксация» — fixation", () => {
  assert.equal(
    extractEventType("Кузнецкий район,Пензенская область - возможно фиксация"),
    "fixation",
  );
});

test("extractEventType: пролёт standalone — fixation", () => {
  assert.equal(extractEventType("Пролет на Б. Мурашкино"), "fixation");
});

test("extractEventType: дрон! — fixation", () => {
  assert.equal(extractEventType("Лугутино, ЛНР дрон!"), "fixation");
});

test("extractEventType: отмена сигнала — cleared", () => {
  assert.equal(
    extractEventType('🟢 ВНИМАНИЕ! Нижегородская область Отмена сигнала "ОПАСНОСТИ АТАКИ БПЛА".'),
    "cleared",
  );
});

test("extractEventType: тревога + осколки сбитых — warning не impact", () => {
  assert.equal(
    extractEventType("Луганск ЛНР тревога по БПЛА сохраняется. Не попадите под осколки сбитых БПЛА"),
    "warning",
  );
});

test("extractEventType: «под осколки» без «сохраняется» — pvo_work (осколки = ПВО отработала)", () => {
  assert.equal(
    extractEventType("Новороссийск тревога по БПЛА. Не попадите под осколки"),
    "pvo_work",
  );
});

test("extractEventType: МО + фиксация — fixation", () => {
  assert.equal(extractEventType("МО Серебряные Пруды Московская область Фиксация БПЛА"), "fixation");
});

test("extractEventType: «возможно бпла» без фиксации — attention", () => {
  assert.equal(extractEventType("Пенза — возможно бпла"), "attention");
});

test("extractEventType: дрон в небе / бпла над городом — fixation", () => {
  assert.equal(extractEventType("дрон в небе над районом"), "fixation");
  assert.equal(extractEventType("БПЛА над городом"), "fixation");
});

test("extractEventType: «Группа БПЛА … в направлении» (обратный порядок) — fixation", () => {
  assert.equal(
    extractEventType("Московская область Группа БПЛА на стыке Тульской и Калужской области в направлении"),
    "fixation",
  );
});
