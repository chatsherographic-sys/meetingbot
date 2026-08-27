export const RANDOM_BOT_NAME_SEQUENCES = [
  [
    "Danny", "Felix", "Alvin", "Jason", "Kelvin", "Bryan", "Darren", "Marcus", "Brandon", "Justin",
    "Aaron", "Wilson", "Raymond", "Vincent", "Jeremy", "Ryan", "Shawn", "Kenneth", "Eric", "Daniel",
    "Adrian", "Samuel", "Nicholas", "Lucas", "Eugene",
  ],
  [
    "Wei Jie", "Kah Chun", "Jun Hao", "Kai Wen", "Zhi Hao", "Jia Wei", "Ming Xuan", "Hong Wei", "Wen Jie", "Zi Yang",
    "Yi Xuan", "Jun Wei", "Hao Ran", "Wei Lun", "Jian Hao", "Ming Hao", "Yu Heng", "Zi Jian", "Kai Xiang", "Cheng Yi",
    "Hong Jie", "Zhi Xuan", "Jia Jun", "Yu Jie", "Wei Ming",
  ],
  [
    "Ng Mun Hon", "Lee Ze Xiang", "Tan Wei Jie", "Lim Jun Hao", "Wong Kai Wen", "Chan Jia Wei", "Goh Ming Xuan", "Yap Zhi Hao", "Teo Kah Chun", "Chua Wen Jie",
    "Low Zi Yang", "Ong Yi Xuan", "Khoo Jun Wei", "Lau Hao Ran", "Sim Wei Lun", "Chew Jian Hao", "Liew Ming Hao", "Foo Yu Heng", "Ho Zi Jian", "Tey Kai Xiang",
    "Soh Cheng Yi", "Yeo Hong Jie", "Chong Zhi Xuan", "Leong Jia Jun", "Khor Yu Jie",
  ],
  [
    "CX", "PJ", "JX", "ZK", "KY", "WL", "ZY", "KH", "JW", "YH", "KC", "WX", "JH", "ZH", "KL", "YK", "MC", "CH", "YJ", "WH", "ZX", "MH", "KJ", "JC", "LH",
  ],
] as const;

const RANDOM_BOT_NAME_POOL = RANDOM_BOT_NAME_SEQUENCES.flat();

export function getRandomBotName(): string {
  return RANDOM_BOT_NAME_POOL[Math.floor(Math.random() * RANDOM_BOT_NAME_POOL.length)];
}

export function getRandomBotNames(count: number): string[] {
  const normalizedCount = Math.max(0, Math.floor(count));
  const shuffledPool = [...RANDOM_BOT_NAME_POOL].sort(() => Math.random() - 0.5);
  const names: string[] = [];

  for (let index = 0; index < normalizedCount; index += 1) {
    names.push(shuffledPool[index % shuffledPool.length]);
  }

  return names;
}
