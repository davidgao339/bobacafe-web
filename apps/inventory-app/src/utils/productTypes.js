// Product types configuration and PO rounding rules

export const PRODUCT_TYPES = [
  {
    id: 'syrup',
    nameRu: 'Сиропы',
    nameEn: 'Syrups',
    roundStep: 1000,
    defaultUnit: 'мл',
    keywords: [/сироп/i, /syrup/i],
  },
  {
    id: 'topping',
    nameRu: 'Топпинги',
    nameEn: 'Toppings',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/топпинг/i, /topping/i, /желе/i, /jelly/i, /алоэ/i, /aloe/i, /боба/i, /boba/i, /nata/i, /тапиок/i, /tapioca/i],
  },
  {
    id: 'coffee',
    nameRu: 'Кофе',
    nameEn: 'Coffee',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/кофе/i, /coffee/i, /эспрессо/i, /espresso/i, /зерн/i],
  },
  {
    id: 'tea',
    nameRu: 'Чай',
    nameEn: 'Tea',
    roundStep: 180,
    defaultUnit: 'г',
    keywords: [/чай/i, /tea/i, /ассам/i, /assam/i, /жасмин/i, /jasmine/i, /улун/i, /oolong/i, /эрл\s*грей/i, /earl\s*grey/i, /сенча/i, /sencha/i, /каркаде/i, /hibiscus/i, /тигуанинь/i],
  },
  {
    id: 'milk',
    nameRu: 'Молоко',
    nameEn: 'Milk',
    roundStep: 12000,
    defaultUnit: 'мл',
    keywords: [/молок/i, /milk/i],
  },
  {
    id: 'cream',
    nameRu: 'Сливки',
    nameEn: 'Cream',
    roundStep: 500,
    defaultUnit: 'мл',
    keywords: [/сливк/i, /cream/i],
  },
  {
    id: 'mochi',
    nameRu: 'Моти',
    nameEn: 'Mochi',
    roundStep: 4,
    defaultUnit: 'шт',
    keywords: [/моти/i, /mochi/i],
  },
  {
    id: 'pancakes',
    nameRu: 'Блинчики / Вафли',
    nameEn: 'Pancakes / Waffles',
    roundStep: 4,
    defaultUnit: 'шт',
    keywords: [/блин/i, /pancake/i, /вафл/i, /waffle/i],
  },
  {
    id: 'corndogs',
    nameRu: 'Корн-доги',
    nameEn: 'Corn dogs',
    roundStep: 5,
    defaultUnit: 'шт',
    keywords: [/корн[\s-]?дог/i, /corn[\s-]?dog/i],
  },
  {
    id: 'cups_plastic_500',
    nameRu: 'Пластиковые стаканы 500мл',
    nameEn: 'Plastic cups 500ml',
    roundStep: 20,
    defaultUnit: 'шт',
    keywords: [/(?=.*500)(?=.*(стакан|cup|пластик|plastic))/i, /стакан.*500/i],
  },
  {
    id: 'cups_plastic_320',
    nameRu: 'Пластиковые стаканы 320мл',
    nameEn: 'Plastic cups 320ml',
    roundStep: 50,
    defaultUnit: 'шт',
    keywords: [/(?=.*320)(?=.*(стакан|cup|пластик|plastic))/i, /стакан.*320/i],
  },
  {
    id: 'cups_paper',
    nameRu: 'Бумажные стаканы',
    nameEn: 'Paper cups',
    roundStep: 30,
    defaultUnit: 'шт',
    keywords: [/бумажн.*стакан/i, /стакан.*бумажн/i, /paper.*cup/i, /стакан.*горяч/i, /стакан.*(250|350|400)/i],
  },
  {
    id: 'sparkling_water',
    nameRu: 'Газированная вода',
    nameEn: 'Sparkling Water',
    roundStep: 1500,
    defaultUnit: 'мл',
    keywords: [/газированн/i, /газ\.?\s*вод/i, /sparkling/i, /минеральн/i, /содов/i],
  },
  {
    id: 'powder',
    nameRu: 'Порошки',
    nameEn: 'Powders',
    roundStep: 500,
    defaultUnit: 'г',
    keywords: [/порошок/i, /порошков/i, /powder/i, /пудра/i, /матча/i, /matcha/i, /сухое\s*молок/i, /сухие\s*сливк/i],
  },
  {
    id: 'patoka',
    nameRu: 'Патока',
    nameEn: 'Patoka',
    roundStep: 700,
    defaultUnit: 'г',
    keywords: [/паток/i, /patoka/i, /мальтоз/i],
  },
  {
    id: 'juice_balls',
    nameRu: 'Джус болы / Поппинг боба',
    nameEn: 'Juice balls / Popping boba',
    roundStep: 3000,
    defaultUnit: 'г',
    keywords: [/джус[\s-]?болл?/i, /джус\s*боллы/i, /джус-боллы/i, /juice[\s-]?ball/i, /поппинг/i, /popping/i],
  },
  {
    id: 'puree',
    nameRu: 'Пюре',
    nameEn: 'Puree',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/пюре/i, /puree/i],
  },
  {
    id: 'cocoa',
    nameRu: 'Какао',
    nameEn: 'Cocoa',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/какао/i, /cocoa/i],
  },
  {
    id: 'juice',
    nameRu: 'Сок',
    nameEn: 'Juice',
    roundStep: 1000,
    defaultUnit: 'мл',
    keywords: [/сок/i, /juice/i, /нектар/i, /nectar/i],
  },
  {
    id: 'sugar',
    nameRu: 'Сахар',
    nameEn: 'Sugar',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/сахар/i, /sugar/i, /фруктоз/i, /fructose/i, /глюкоз/i],
  },
  {
    id: 'lids',
    nameRu: 'Крышки',
    nameEn: 'Lids',
    roundStep: 50,
    defaultUnit: 'шт',
    keywords: [/крышк/i, /lid/i],
  },
  {
    id: 'straws',
    nameRu: 'Трубочки',
    nameEn: 'Straws',
    roundStep: 250,
    defaultUnit: 'шт',
    keywords: [/трубочк/i, /straw/i],
  },
  {
    id: 'marshmallow',
    nameRu: 'Маршмеллоу',
    nameEn: 'Marshmallow',
    roundStep: 100,
    defaultUnit: 'г',
    keywords: [/маршмеллоу/i, /marshmallow/i],
  },
  {
    id: 'cheese_powder',
    nameRu: 'Сырный порошок',
    nameEn: 'Cheese powder',
    roundStep: 1000,
    defaultUnit: 'г',
    keywords: [/сырн.*порошок/i, /cheese.*powder/i, /порошок.*сырн/i],
  },
  {
    id: 'other',
    nameRu: 'Другое (без кратности)',
    nameEn: 'Other (no rounding)',
    roundStep: 1,
    defaultUnit: '',
    keywords: [],
  },
]

export const PRODUCT_TYPE_MAP = Object.fromEntries(
  PRODUCT_TYPES.map(pt => [pt.id, pt])
)

/**
 * Detect product type from ingredient name and unit using keyword priority order
 */
export function detectProductType(name = '', unit = '') {
  if (!name || typeof name !== 'string') return null
  const cleanName = name.trim()

  // 1. Cups with specific sizes first
  if (/(?=.*500)(?=.*(стакан|cup|пластик|plastic))/i.test(cleanName) || /стакан.*500/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cups_plastic_500']
  }
  if (/(?=.*320)(?=.*(стакан|cup|пластик|plastic))/i.test(cleanName) || /стакан.*320/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cups_plastic_320']
  }
  if (/бумажн.*стакан/i.test(cleanName) || /стакан.*бумажн/i.test(cleanName) || /paper.*cup/i.test(cleanName) || /стакан.*горяч/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cups_paper']
  }

  // 2. Juice balls / Popping boba before toppings / juice
  if (/джус[\s-]?болл?/i.test(cleanName) || /джус\s*боллы/i.test(cleanName) || /джус-боллы/i.test(cleanName) || /juice[\s-]?ball/i.test(cleanName) || /поппинг/i.test(cleanName) || /popping/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['juice_balls']
  }

  // 3. Patoka
  if (/паток/i.test(cleanName) || /patoka/i.test(cleanName) || /мальтоз/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['patoka']
  }

  // 4. Sparkling Water
  if (/газированн/i.test(cleanName) || /газ\.?\s*вод/i.test(cleanName) || /sparkling/i.test(cleanName) || /содов/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['sparkling_water']
  }

  // 5. Snacks: Corn dogs, Mochi, Pancakes
  if (/корн[\s-]?дог/i.test(cleanName) || /corn[\s-]?dog/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['corndogs']
  }
  if (/моти/i.test(cleanName) || /mochi/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['mochi']
  }
  if (/блин/i.test(cleanName) || /pancake/i.test(cleanName) || /вафл/i.test(cleanName) || /waffle/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['pancakes']
  }

  // 6. Powders (and Cocoa before generic powder/syrups)
  if (/какао/i.test(cleanName) || /cocoa/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cocoa']
  }
  if (/сырн.*порошок/i.test(cleanName) || /cheese.*powder/i.test(cleanName) || /порошок.*сырн/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cheese_powder']
  }
  if (/сухое\s*молок/i.test(cleanName) || /сухие\s*сливк/i.test(cleanName) || /порошок/i.test(cleanName) || /порошков/i.test(cleanName) || /powder/i.test(cleanName) || /пудра/i.test(cleanName) || /матча/i.test(cleanName) || /matcha/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['powder']
  }

  // 7. Cream (500)
  if (/сливк/i.test(cleanName) || /cream/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['cream']
  }

  // 8. Milk (12000)
  if (/молок/i.test(cleanName) || /milk/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['milk']
  }

  // 8. Tea
  if (/чай/i.test(cleanName) || /tea/i.test(cleanName) || /ассам/i.test(cleanName) || /assam/i.test(cleanName) || /жасмин/i.test(cleanName) || /jasmine/i.test(cleanName) || /улун/i.test(cleanName) || /oolong/i.test(cleanName) || /эрл\s*грей/i.test(cleanName) || /earl\s*grey/i.test(cleanName) || /сенча/i.test(cleanName) || /sencha/i.test(cleanName) || /каркаде/i.test(cleanName) || /hibiscus/i.test(cleanName) || /тигуанинь/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['tea']
  }

  // 9. Coffee
  if (/кофе/i.test(cleanName) || /coffee/i.test(cleanName) || /эспрессо/i.test(cleanName) || /espresso/i.test(cleanName) || /зерн/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['coffee']
  }

  // 10. Puree
  if (/пюре/i.test(cleanName) || /puree/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['puree']
  }

  // 11. Sugar
  if (/сахар/i.test(cleanName) || /sugar/i.test(cleanName) || /фруктоз/i.test(cleanName) || /fructose/i.test(cleanName) || /глюкоз/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['sugar']
  }

  // 12. Syrups
  if (/сироп/i.test(cleanName) || /syrup/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['syrup']
  }

  // 13. Juice
  if (/сок/i.test(cleanName) || /juice/i.test(cleanName) || /нектар/i.test(cleanName) || /nectar/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['juice']
  }

  // 14. Toppings
  if (/топпинг/i.test(cleanName) || /topping/i.test(cleanName) || /желе/i.test(cleanName) || /jelly/i.test(cleanName) || /алоэ/i.test(cleanName) || /aloe/i.test(cleanName) || /боба/i.test(cleanName) || /boba/i.test(cleanName) || /nata/i.test(cleanName) || /тапиок/i.test(cleanName) || /tapioca/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['topping']
  }

  // 15. Packaging and Miscellaneous
  if (/крышк/i.test(cleanName) || /lid/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['lids']
  }
  if (/трубочк/i.test(cleanName) || /straw/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['straws']
  }
  if (/маршмеллоу/i.test(cleanName) || /marshmallow/i.test(cleanName)) {
    return PRODUCT_TYPE_MAP['marshmallow']
  }

  return null
}

/**
 * Get the effective product type descriptor for an ingredient
 */
export function getProductType(ingredient) {
  if (!ingredient) return PRODUCT_TYPE_MAP['other']
  if (ingredient.productType && PRODUCT_TYPE_MAP[ingredient.productType]) {
    return PRODUCT_TYPE_MAP[ingredient.productType]
  }
  const detected = detectProductType(ingredient.name, ingredient.unit)
  return detected || PRODUCT_TYPE_MAP['other']
}

/**
 * Get the rounding step (pack size multiple) for an ingredient
 */
export function getRoundStep(ingredient) {
  if (!ingredient) return 1
  if (ingredient.customStep && Number(ingredient.customStep) > 0) {
    return Number(ingredient.customStep)
  }
  const pt = getProductType(ingredient)
  return pt?.roundStep || 1
}

/**
 * Calculate rounded order quantity according to product type step
 * @param {number} rawNeeded - Raw needed amount
 * @param {object} ingredient - Ingredient object
 * @returns {number} - Rounded up quantity (multiple of step)
 */
export function roundOrderQty(rawNeeded, ingredient) {
  if (!rawNeeded || rawNeeded <= 0) return 0
  const step = getRoundStep(ingredient)
  if (step <= 1) return Math.ceil(rawNeeded)
  return Math.ceil(rawNeeded / step) * step
}
