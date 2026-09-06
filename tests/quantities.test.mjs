import { test } from "node:test"
import assert from "node:assert/strict"
import { parseServings, splitIngredient, scaleAmount } from "../src/quantities.ts"

test("only explicit, unambiguous serving counts become a denominator", () => {
  for (const label of ["2人分", "２人前", "2 servings", "2(servings)"]) assert.equal(parseServings(label), 2)
  for (const label of ["2～3人分", "2", "4個", "", "0人分", "2人分（例：切り身2～3枚）"]) assert.equal(parseServings(label), null)
})
test("scales fractions, ranges, mixed numbers, fullwidth units and weight annotations", () => {
  for (const [value, ratio, expected] of [
    ["大さじ1と1/2", 2, "大さじ3"], ["1・1/2カップ", 2, "3カップ"],
    ["350～400g", 2, "700~800g"], ["1/2本（約75g）", 2, "1本(約150g)"],
    ["2切れ(200g)", 0.5, "1切れ(100g)"], ["１００ｇ", 2, "200g"],
    ["小さじ2/3", 1.5, "小さじ1"], ["1 1/2カップ", 2, "3カップ"],
  ]) assert.equal(scaleAmount(value, ratio).text, expected)
})
test("leaves ratios, dimensions and unclear quantities intact", () => {
  for (const value of ["少々", "適量", "鮭の重さの1%", "15cmくらい", "半分", "濃縮4倍", "1/0個", "清酒100ml＋水100ml＋塩2g"]) {
    assert.deepEqual(scaleAmount(value, 2), { text: value, unchanged: true })
  }
})
test("splits legacy ingredients without touching product-name numbers", () => {
  assert.deepEqual(splitIngredient({name:"濃いだし本つゆ(濃縮4倍) 大さじ2", amount:""}), {name:"濃いだし本つゆ(濃縮4倍)", amount:"大さじ2"})
  assert.deepEqual(splitIngredient({name:"ふき: 70 g", amount:""}), {name:"ふき", amount:"70 g"})
  assert.deepEqual(splitIngredient({name:"トマトソース295g", amount:"1缶"}), {name:"トマトソース295g", amount:"1缶"})
})
test("uses the source serving count instead of assuming two servings", () => {
  assert.equal(scaleAmount("500g", 2 / parseServings("4(servings)")).text, "250g")
  assert.equal(scaleAmount("70g", 3 / parseServings("1人分")).text, "210g")
})
