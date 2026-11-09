/**
 * Character OS v2 — Unified Inventory Engine
 * 统一空间物品图谱管理、跨日程与场景持有保留、视野动态过滤与常识流转
 */

import type { Character, InventoryItem } from '../shared/types.ts';
import type { Repositories } from '../db/repositories.ts';

export interface VisibleInventorySnapshot {
  equipped: InventoryItem[];
  held: InventoryItem[];
  carried: InventoryItem[];
  environmentItems: InventoryItem[];
}

export type InventoryMutationAction =
  | 'set_outfit'
  | 'hold'
  | 'put_in_bag'
  | 'consume_or_remove'
  | 'add_home_item';

export interface InventoryMutation {
  action: InventoryMutationAction;
  name: string;
  quantity?: number;
  unit?: string;
  locationTag?: string;
  description?: string;
}

export class InventoryEngine {
  private readonly repos: Repositories;

  constructor(repos: Repositories) {
    this.repos = repos;
  }

  /**
   * 为角色初始化默认穿着与常备随身背包物品
   */
  public initializeDefaultInventory(userId: string, character: Character): void {
    const existing = this.repos.listInventoryItems(userId, character.id, [
      'character_equipped',
      'character_carried',
    ]);
    if (existing.length > 0) return;

    if (character.lifestyleProfile.defaultOutfit) {
      this.repos.upsertInventoryItem({
        userId,
        characterId: character.id,
        scope: 'character_equipped',
        name: character.lifestyleProfile.defaultOutfit,
        quantity: 1,
        unit: '套',
        locationTag: '身上',
        description: '初始默认着装',
      });
    }

    const carried = character.lifestyleProfile.defaultCarriedItems || [];
    for (const itemName of carried) {
      if (!itemName) continue;
      this.repos.upsertInventoryItem({
        userId,
        characterId: character.id,
        scope: 'character_carried',
        name: itemName,
        quantity: 1,
        unit: '件',
        locationTag: '随身',
        description: '角色常备随身物品',
      });
    }
  }

  /**
   * 获取当前感知快照中的可见物品
   * 穿着、手持与随身物跨日程/跨场景永久保留；家/冰箱物品在出门时隐去
   */
  public getVisibleInventoryForPerception(
    userId: string,
    character: Character,
    currentLocation: string,
  ): VisibleInventorySnapshot {
    const equipped = this.repos.listInventoryItems(userId, character.id, ['character_equipped']);
    const held = this.repos.listInventoryItems(userId, character.id, ['character_held']);
    const carried = this.repos.listInventoryItems(userId, character.id, ['character_carried']);

    const isAtHome = this.checkIsAtHome(currentLocation, character.lifestyleProfile.homeLocation);
    const environmentItems = isAtHome
      ? this.repos.listInventoryItems(userId, character.id, ['character_private', 'shared_home'])
      : [];

    return { equipped, held, carried, environmentItems };
  }

  /**
   * 应用状态流转变动（换装、拿取、入包、扣减消耗、存入家中）
   */
  public applyInventoryMutations(
    userId: string,
    characterId: string,
    mutations: InventoryMutation[],
  ): void {
    for (const m of mutations) {
      switch (m.action) {
        case 'set_outfit': {
          const old = this.repos.listInventoryItems(userId, characterId, ['character_equipped']);
          for (const item of old) {
            this.repos.deleteInventoryItem(item.id);
          }
          this.repos.upsertInventoryItem({
            userId,
            characterId,
            scope: 'character_equipped',
            name: m.name,
            quantity: m.quantity ?? 1,
            unit: m.unit || '套',
            locationTag: m.locationTag || '身上',
            description: m.description || '当前穿着',
          });
          this.repos.updateRelationship(userId, characterId, { outfitDesc: m.name });
          break;
        }

        case 'hold': {
          this.repos.upsertInventoryItem({
            userId,
            characterId,
            scope: 'character_held',
            name: m.name,
            quantity: m.quantity ?? 1,
            unit: m.unit || '个',
            locationTag: m.locationTag || '手中',
            description: m.description || '',
          });
          break;
        }

        case 'put_in_bag': {
          const held = this.repos
            .listInventoryItems(userId, characterId, ['character_held'])
            .find((i) => i.name === m.name);
          if (held) {
            this.repos.deleteInventoryItem(held.id);
          }
          this.repos.upsertInventoryItem({
            userId,
            characterId,
            scope: 'character_carried',
            name: m.name,
            quantity: m.quantity ?? (held ? held.quantity : 1),
            unit: m.unit || held?.unit || '件',
            locationTag: m.locationTag || '随身背包',
            description: m.description || held?.description || '',
          });
          break;
        }

        case 'consume_or_remove': {
          const allItems = this.repos.listInventoryItems(userId, characterId);
          const target = allItems.find((i) => i.name === m.name);
          if (target) {
            const deduct = m.quantity ?? 1;
            const remaining = target.quantity - deduct;
            if (remaining <= 0) {
              this.repos.deleteInventoryItem(target.id);
            } else {
              this.repos.upsertInventoryItem({
                id: target.id,
                userId,
                characterId,
                scope: target.scope,
                name: target.name,
                quantity: remaining,
                unit: target.unit,
                locationTag: target.locationTag,
                description: target.description,
              });
            }
          }
          break;
        }

        case 'add_home_item': {
          const homeItems = this.repos.listInventoryItems(userId, characterId, ['shared_home']);
          const existing = homeItems.find((i) => i.name === m.name);
          const qty = (existing?.quantity ?? 0) + (m.quantity ?? 1);
          this.repos.upsertInventoryItem({
            ...(existing ? { id: existing.id } : {}),
            userId,
            characterId,
            scope: 'shared_home',
            name: m.name,
            quantity: existing ? qty : (m.quantity ?? 1),
            unit: m.unit || existing?.unit || '个',
            locationTag: m.locationTag || existing?.locationTag || '家里/冰箱',
            description: m.description || existing?.description || '',
          });
          break;
        }
      }
    }
  }

  private checkIsAtHome(currentLocation: string, homeLocation: string): boolean {
    const loc = (currentLocation || '').trim().toLowerCase();
    const home = (homeLocation || '').trim().toLowerCase();
    if (!loc) return true;
    if (home && (loc === home || loc.includes(home) || home.includes(loc))) {
      return true;
    }
    return /家|卧室|客厅|厨房|书房|浴室|公寓|宅|404|茶室/u.test(loc);
  }
}
