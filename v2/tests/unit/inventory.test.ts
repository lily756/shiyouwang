/**
 * Character OS v2 — Unified Inventory Engine Unit Tests
 * 验证物品跨日程持有保留、场景视野过滤、初始背包/着装注入与状态流转
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../src/db/connection.ts';
import { Repositories } from '../../src/db/repositories.ts';
import { InventoryEngine } from '../../src/engine/inventory-engine.ts';

describe('InventoryEngine Unit Tests', () => {
  const db = createDatabase();
  const repos = new Repositories(db);
  const engine = new InventoryEngine(repos);

  const user = repos.createUser({ username: 'akira', displayName: 'Akira' });
  const character = repos.createCharacter({
    creatorUserId: user.id,
    name: '双炽',
    corePersona: '忠诚妖仆',
    lifestyleProfile: {
      homeLocation: '妖馆404室',
      defaultEnvironment: '和式茶室',
      usualPlaces: ['妖馆404室', '庭院'],
      dailyBaseline: '泡茶侍奉',
      defaultOutfit: '黑色西装',
      defaultCarriedItems: ['怀表', '备用手帕'],
    },
  });

  it('initializes default inventory with equipped outfit and carried items', () => {
    engine.initializeDefaultInventory(user.id, character);

    const equipped = repos.listInventoryItems(user.id, character.id, ['character_equipped']);
    assert.equal(equipped.length, 1);
    assert.equal(equipped[0].name, '黑色西装');
    assert.equal(equipped[0].scope, 'character_equipped');

    const carried = repos.listInventoryItems(user.id, character.id, ['character_carried']);
    assert.equal(carried.length, 2);
    const names = carried.map((i) => i.name);
    assert.ok(names.includes('怀表'));
    assert.ok(names.includes('备用手帕'));

    // Idempotent: repeated calls do nothing
    engine.initializeDefaultInventory(user.id, character);
    assert.equal(repos.listInventoryItems(user.id, character.id, ['character_equipped']).length, 1);
  });

  it('guarantees held and carried items persist across schedule block changes and location moves', () => {
    // 角色在 09:00 泡茶时拿起“保温杯”
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'hold', name: '银质保温杯', quantity: 1, unit: '个', locationTag: '右手' },
    ]);

    // 检查 09:00 在茶室时的可见物品
    const viewAt09 = engine.getVisibleInventoryForPerception(user.id, character, '妖馆茶室');
    assert.equal(viewAt09.held.length, 1);
    assert.equal(viewAt09.held[0].name, '银质保温杯');
    assert.equal(viewAt09.carried.length, 2);
    assert.equal(viewAt09.equipped[0].name, '黑色西装');

    // 切换到 10:30，角色移动到“中央商业街”
    const viewAt1030 = engine.getVisibleInventoryForPerception(user.id, character, '中央商业街');
    // 所持保温杯与随身怀表、手帕完整保留，绝对不会丢失！
    assert.equal(viewAt1030.held.length, 1);
    assert.equal(viewAt1030.held[0].name, '银质保温杯');
    assert.equal(viewAt1030.carried.length, 2);
    assert.equal(viewAt1030.equipped[0].name, '黑色西装');
  });

  it('filters environment items: visible at home, hidden when away from home', () => {
    // 向家里冰箱放入牛奶
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'add_home_item', name: '特仑苏牛奶', quantity: 2, unit: '盒', locationTag: '厨房冰箱' },
    ]);

    // 1. 角色在“妖馆404室”（家中）时，视野内包含冰箱里的牛奶
    const homeView = engine.getVisibleInventoryForPerception(user.id, character, '妖馆404室');
    const homeItemNames = homeView.environmentItems.map((i) => i.name);
    assert.ok(homeItemNames.includes('特仑苏牛奶'));
    assert.equal(homeView.environmentItems.find((i) => i.name === '特仑苏牛奶')?.quantity, 2);

    // 2. 角色移动到“欢乐游乐园”（室外地点）时，视野中仅有随身/手持物，家里冰箱物品自动隐去
    const outdoorView = engine.getVisibleInventoryForPerception(user.id, character, '欢乐游乐园');
    assert.equal(outdoorView.environmentItems.length, 0);
    // 随身物不受任何影响
    assert.equal(outdoorView.held.length, 1);
    assert.equal(outdoorView.carried.length, 2);

    // 3. 角色返回“客厅/家中”时，冰箱物品再次可见
    const returnHomeView = engine.getVisibleInventoryForPerception(user.id, character, '客厅');
    assert.ok(returnHomeView.environmentItems.some((i) => i.name === '特仑苏牛奶'));
  });

  it('handles state transitions: hold -> put_in_bag, consume milk, and set_outfit', () => {
    repos.ensureRelationship(user.id, character.id, character);

    // 1. put_in_bag: 将手中的“银质保温杯”放入背包
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'put_in_bag', name: '银质保温杯' },
    ]);
    const afterBag = engine.getVisibleInventoryForPerception(user.id, character, '妖馆404室');
    assert.equal(afterBag.held.length, 0); // 手中已空
    assert.ok(afterBag.carried.some((i) => i.name === '银质保温杯')); // 已入包

    // 2. consume_or_remove: 喝掉一盒牛奶 (2 -> 1)
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'consume_or_remove', name: '特仑苏牛奶', quantity: 1 },
    ]);
    const afterDrinkOne = engine.getVisibleInventoryForPerception(user.id, character, '妖馆404室');
    assert.equal(afterDrinkOne.environmentItems.find((i) => i.name === '特仑苏牛奶')?.quantity, 1);

    // 再喝掉一盒 (1 -> 0 自动从数据库清除)
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'consume_or_remove', name: '特仑苏牛奶', quantity: 1 },
    ]);
    const afterDrinkAll = engine.getVisibleInventoryForPerception(user.id, character, '妖馆404室');
    assert.equal(afterDrinkAll.environmentItems.find((i) => i.name === '特仑苏牛奶'), undefined);

    // 3. set_outfit: 换上休闲和服，旧西装移除，且关系表的 outfitDesc 同步更新
    engine.applyInventoryMutations(user.id, character.id, [
      { action: 'set_outfit', name: '月白色暗纹和服', description: '主人挑选的居家居服' },
    ]);
    const afterOutfit = engine.getVisibleInventoryForPerception(user.id, character, '妖馆404室');
    assert.equal(afterOutfit.equipped.length, 1);
    assert.equal(afterOutfit.equipped[0].name, '月白色暗纹和服');

    const rel = repos.getRelationship(user.id, character.id);
    assert.equal(rel?.outfitDesc, '月白色暗纹和服');
  });
});
