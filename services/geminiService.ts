import { Resources, GameEvent } from '../src/shared/types';

// Pre-defined events to simulate AI generation
const LOCAL_EVENTS: GameEvent[] = [
  {
    title: "Bountiful Harvest",
    description: "The lands are fertile this season. Crops are growing faster than usual.",
    severity: "GOOD",
    effect: "Gained resources"
  },
  {
    title: "Goblin Raiders",
    description: "A small band of goblins was spotted near the lumber mill. They stole some timber.",
    severity: "BAD",
    effect: "Lost resources"
  },
  {
    title: "Wandering Bard",
    description: "A bard visits the settlement, raising spirits with songs of old heroes.",
    severity: "GOOD",
    effect: "Population morale boost"
  },
  {
    title: "Minor Tremor",
    description: "The ground shook briefly. No major damage, but the villagers are spooked.",
    severity: "NEUTRAL",
    effect: "No effect"
  },
  {
    title: "Merchant Caravan",
    description: "A trade caravan passes through, offering gold for safe passage.",
    severity: "GOOD",
    effect: "Gained Gold"
  },
  {
    title: "Heavy Rains",
    description: "Constant rain has made work difficult in the forests.",
    severity: "BAD",
    effect: "Lost Wood"
  },
  {
    title: "Peaceful Days",
    description: "The birds are singing. It is a quiet time for the settlement.",
    severity: "NEUTRAL",
    effect: "No effect"
  }
];

export const generateGameEvent = async (
  resources: Resources,
  turnCount: number,
  biome: string
): Promise<GameEvent> => {
  // Simulate network delay for "thinking" effect
  await new Promise(resolve => setTimeout(resolve, 600));

  // Pick a random event
  const randomIndex = Math.floor(Math.random() * LOCAL_EVENTS.length);
  return LOCAL_EVENTS[randomIndex];
};
