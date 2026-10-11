// «Докопаться до Америки» — вся настраиваемая игровая конфигурация.
// Все числа — стартовые гипотезы баланса (см. ТЗ §11).
window.CFG = {
  SEG: 22,            // длина сегмента в клетках
  SEGL: [24, 27, 30, 34, 38, 42, 46, 50, 56, 64],   // каждый участок длиннее предыдущего, финал — самый длинный
  CHAPTERS: 10,
  H: 58,              // высота карты
  SURFACE: 7,         // первая строка грунта (выше — небо/море/дно)
  CT: 11, CB: 13,     // проектный коридор (строки)
  HOT_FROM: 38,       // горячая зона с этой строки

  // типы блоков: hard — прочность (0 = пусто, 99 = неразрушимый)
  BLOCKS: {
    0: { name: 'Empty', hard: 0 },
    1: { name: 'Soil', hard: 1 },
    2: { name: 'Permafrost', hard: 2 },
    3: { name: 'Rock', hard: 3 },
    4: { name: 'Granite', hard: 4 },
    5: { name: 'Basalt', hard: 5 },
    6: { name: 'Bedrock', hard: 99 },
    7: { name: 'Seabed', hard: 99 },
    8: { name: 'Rubble', hard: 1 },
    9: { name: 'Unstable ground', hard: 1 },
  },

  ORES: {
    1: { key: 'iron', name: 'Iron', price: 5, icon: '🪨' },
    2: { key: 'copper', name: 'Copper', price: 8, icon: '🟠' },
    3: { key: 'gold', name: 'Gold', price: 30, icon: '🟡' },
    4: { key: 'diamond', name: 'Diamond', price: 120, icon: '💎' },
    5: { key: 'colored', name: 'Colored diamond', price: 250, icon: '💗' },
    6: { key: 'artifact', name: 'Artifact', price: 0, icon: '📦' },
  },

  COLORED: [
    { name: 'Chukotka Pink', color: '#ff5fa8' },
    { name: 'Permafrost Blue', color: '#6fd8ff' },
    { name: 'Budget Green', color: '#5ff08a' },
    { name: 'Undersea Blue', color: '#4a6bff' },
    { name: 'Island Amber', color: '#ffb23f' },
    { name: 'Granite Violet', color: '#b06bff' },
    { name: 'Yesterday Red', color: '#ff4a4a' },
    { name: 'Prototype Black', color: '#4b4b5e' },
    { name: 'Alaskan Gold', color: '#ffe14a' },
    { name: 'Junction Rainbow', color: 'rainbow' },
  ],

  ARTIFACTS: [
    { name: 'Lucky hard hat of the first shift', text: 'Worn only on holidays. Today is a holiday.' },
    { name: 'Lost blueprint', text: 'Someone drew a bridge on the back. In pencil.' },
    { name: '110/220 plug adapter', text: 'The project\'s main engineering problem, solved in advance.' },
    { name: 'Flash drive with the tunnel pitch deck', text: '147 slides. The last one says "Questions?".' },
    { name: 'Fossilized deadline', text: 'Age: about three quarters.' },
    { name: 'First investor\'s shovel', text: 'Barely used.' },
  ],

  // ветки улучшений: значения по ступеням 1..5
  UPGRADES: {
    drill:   { name: 'Drill', desc: 'Digs faster and breaks through hard rock', vals: [1.6, 2.2, 3.0, 4.0, 5.2], fmt: v => v.toFixed(1) + '/s' },
    tank:    { name: 'Tank', desc: 'More fuel — dig longer without going back to base', vals: [40, 60, 85, 115, 150], fmt: v => v + ' L' },
    cooling: { name: 'Cooling', desc: 'Drill heats up less — dig without stopping', vals: [9, 12, 16, 21, 27], fmt: v => v + '°/s' },
    hull:    { name: 'Hull', desc: 'Sturdier machine — fewer crashes', vals: [40, 60, 85, 115, 150], fmt: v => v + ' pts' },
    cargo:   { name: 'Cargo', desc: 'More loot per trip', vals: [6, 9, 13, 18, 25], fmt: v => v + ' slots' },
    scanner: { name: 'Scanner', desc: 'Sees treasure farther and more precisely', vals: [5, 7, 9, 12, 15], fmt: v => v + ' cells' },
    drive:   { name: 'Drive', desc: 'Moves faster through the tunnel', vals: [1, 1.15, 1.3, 1.45, 1.6], fmt: v => '×' + v.toFixed(2) },
  },
  UP_COST: [0, 80, 320, 950, 2400],      // цена перехода на ступень (индекс = новая ступень-1)
  UP_MULT: { drill: 1.3, tank: 1, cooling: 0.9, hull: 1, cargo: 1.1, scanner: 0.8, drive: 0.9 },

  CONSUMABLES: {
    can:  { name: 'Fuel can', icon: '⛽', price: 35, desc: 'Refill half a tank right underground' },
    rep:  { name: 'Repair kit', icon: '🔧', price: 45, desc: 'Patch up the machine right underground' },
    cool: { name: 'Cooling charge', icon: '❄️', price: 25, desc: 'Instantly cools the drill' },
  },

  FUEL_PRICE: 0.5,   // монет за литр
  REPAIR_PRICE: 0.8, // монет за единицу корпуса
  START_COINS: 40,

  // требования сегментов по главам
  segReq: c => ({ iron: 5 + 2 * c, copper: 2 + 2 * c, reward: 40 + 12 * c }),   // награда за станцию скромная — на улучшения нужно добывать руду
  // максимальная прочность на обязательном маршруте и рекомендуемый бур
  corridorHard: [2, 3, 3, 4, 4, 4, 5, 5, 5, 5],   // с 4-го участка нужен бур 3, с 7-го — бур 4

  CHAPTERS_DATA: [
    { title: 'Chukotka. The start of something great', rec: 'Drill 1', joke: 'The first meters are the most important. And the dirtiest.',
      intro: [['petrovich', 'The project is ready. All that\'s left is to dig it. Here\'s your rig — dig!'],
              ['petrovich', 'The goal is simple: dig right until you reach Alaska. Along the way there are stations with fuel and upgrades.'],
              ['alya', 'Watch your fuel and cargo. An empty tank under the sea isn\'t an adventure, it\'s an evacuation.']] },
    { title: 'Permafrost', rec: 'Drill 2', joke: 'Found a mammoth with a sign: "I was here first".',
      intro: [['petrovich', 'Permafrost ahead. Hard as yesterday\'s gingerbread.'],
              ['alya', 'New gauge 🌡 — heat. The drill heats up: when it turns red, stop and let it cool. Or upgrade the cooling.'],
              ['petrovich', 'One more thing: refueling isn\'t free anymore. Coins are taken automatically when you return to base.']] },
    { title: 'First diamond', rec: 'Drill 2, Scanner 2', joke: 'The tunnel has temporarily become a jewelry business.',
      intro: [['alya', 'The scanner finds diamonds below the corridor. Press 📡 — I\'ll show you where.'],
              ['petrovich', 'Just remember: the tunnel comes first. Diamonds are a nice bonus.']] },
    { title: 'Under the seabed', rec: 'Drill 3, Hull 2', joke: 'Now it\'s a water park too.',
      intro: [['alya', 'We\'re under the seabed. Blue drops in the rock are water pockets.'],
              ['alya', 'If you break one — rush to the marked pump and switch it on before everything floods.'],
              ['petrovich', 'New gauge 🛡 — hull. Water, gas and cave-ins scratch it. Repairs are at the base.']] },
    { title: 'Island break', rec: 'Drill 3, Tank 3', joke: 'Found a note: "Who ate my sandwich? — Crew 2"',
      intro: [['petrovich', 'Above us are Big and Little Diomede islands. They\'re 4 km apart — and a whole day apart in time.'],
              ['petrovich', 'Deeper means richer veins. Your call: hurry or get rich.']] },
    { title: 'Very hard granite', rec: 'Drill 3, Cooling 3', joke: 'Hard science turned out to be literally hard.',
      intro: [['alya', 'Green spots are gas pockets. Hot drill + gas = a very short trip.'],
              ['alya', 'Approach gas with a cool drill. The cooling charge ❄️ is your friend.']] },
    { title: 'International Date Line', rec: 'Drill 4, Drive 3', joke: 'Deadline — yesterday. Totally normal here.',
      intro: [['petrovich', 'We\'re crossing the Date Line. The clocks now say "yesterday".'],
              ['petrovich', 'Good news: we finished this stage yesterday. Bad news: we still have to dig it.']] },
    { title: 'The billionaire sent a drill', rec: 'Drill 4', joke: 'Update installed. The "back" button has been removed.',
      intro: [['billionaire', 'Guys! A revolutionary drill! Digs twice as fast! Heats up... also twice as fast.'],
              ['alya', 'You can install the prototype at the base for free. Just keep an eye on the temperature.']] },
    { title: 'Alaska is close', rec: 'Drill 4, Hull 4', joke: 'Found oil. No exit yet.',
      intro: [['petrovich', 'See the cracked ground? Dig under it and it\'ll collapse. On your head.'],
              ['bob', 'Hello, Russia! We\'re digging toward you! You count in meters, right?..']] },
    { title: 'Meeting under the strait', rec: 'Everything maxed', joke: 'They counted in feet. We counted in meters.',
      intro: [['bob', 'We can already hear your drill! One last section — and we connect!'],
              ['petrovich', 'Go on then. Carefully. So we don\'t miss each other by half a meter. Or half a foot.']] },
  ],

  // Лавка за Telegram Stars: всё необязательно, игра проходится без покупок
  SHOP: [
    { id: 'skin_gold', icon: '✨', name: 'Golden drill', desc: 'A gold-plated machine with sparkles. Same speed, maximum swagger.', stars: 25 },
    { id: 'cat', icon: '🐈', name: 'Foreman Cat', desc: 'Sits on the roof of the rig and comments on the work. Zero use, a hundred percent morale.', stars: 15 },
    { id: 'tank_plus', icon: '🛢️', name: 'Billionaire\'s tank', desc: '+30% tank capacity forever. Longer trips.', stars: 49 },
    { id: 'lift', icon: '🚀', name: 'Rocket lift', desc: 'Climbs shafts without fuel and twice as fast.', stars: 39 },
    { id: 'insurance', icon: '📄', name: '"Drill Shield" insurance', desc: 'Your loot is never lost in a crash. Forever.', stars: 59 },
    { id: 'coins', icon: '💰', name: 'Crew bonus', desc: '+400 coins. Can be bought multiple times.', stars: 29, consumable: true },
    { id: 'estimate', icon: '⚡', name: 'Turbo shift', desc: 'For 3 minutes the drill digs twice as fast and never overheats. Can be bought many times.', stars: 35, consumable: true },
  ],

  CHARS: {
    cat: { name: 'Foreman Cat', img: 'assets/cat.webp' },
    petrovich: { name: 'Foreman Petrovich', img: 'assets/petrovich.webp' },
    alya: { name: 'Engineer Alya', img: 'assets/alya.webp' },
    bob: { name: 'Bob, Alaska crew', img: 'assets/bob.webp' },
    billionaire: { name: 'Tech billionaire', img: 'assets/billionaire.webp' },
  },

  JOKES: {
    branches: 'You were supposed to connect continents, but you\'ve been mining diamonds for three days.',
    bigSale: 'The budget adds up again.',
    station: 'There\'s coffee. No internet yet.',
    empty: 'Empty cargo? Next time go up or down — that\'s where the ore is!',
    finish: 'Continents connected. Now we just need to agree on power sockets.',
    ambient: [
      'Alya ordered pizza. The courier has been looking for the entrance for two hours.',
      'Petrovich found a 1999 toffee in his pocket. Says it\'s still chewable.',
      'The Americans are asking about our rail gauge. We\'re looking.',
      'A walrus swam by. It looked disapproving.',
      'Someone hung a "Do not dig" sign in the tunnel. Ignored.',
      'Got 4G in the tunnel. It was an echo.',
      'Alya calculated: at this pace we\'ll make it by Friday. She didn\'t say which one.',
    ],
  },

  QUESTS: [
    { id: 'diamond', text: 'Deliver your first diamond', reward: 60 },
    { id: 'cool', text: 'A trip without overheating (with loot)', reward: 40 },
    { id: 'full', text: 'Bring back a full cargo hold', reward: 50 },
    { id: 'leak', text: 'Fix a leak', reward: 80 },
    { id: 'blueprint', text: 'Find the lost blueprint', reward: 70 },
    { id: 'noevac', text: 'Finish a section without evacuation', reward: 90 },
  ],

  ACH: {
    dug: { name: 'Dug through', desc: 'Connect Chukotka and Alaska' },
    distract: { name: 'Diamond distraction', desc: 'Deliver 10 diamonds' },
    budget: { name: 'Budget held up', desc: 'Save up 1000 coins' },
    core: { name: 'Tunnel through the Earth\'s core', desc: 'Reach the very bottom of the map' },
    lastdrop: { name: 'Last drop', desc: 'Return to base with less than 5% fuel' },
    noleak: { name: 'Not a single leak', desc: 'Fix a leak in time' },
  },
};
