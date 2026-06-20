import type { PlaceScanEntry } from "@radar/shared";
import { PlaceScanService } from "./placeScanService.js";

/** GF-P6 / golden: минимальный каталог Нижегородской + Ростов + Брянск. */
export const GF_P6_SCAN_ENTRIES: PlaceScanEntry[] = [
  {
    placeId: "11111111-1111-1111-1111-111111111101",
    regionId: "22222222-2222-2222-2222-222222222201",
    regionIso: "RU-NIZ",
    kind: "region",
    name: "Нижегородская область",
    nameStem: "нижегородская",
    nameWithType: "Нижегородская область",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111102",
    regionId: "22222222-2222-2222-2222-222222222201",
    regionIso: "RU-NIZ",
    kind: "district",
    name: "Кулебакский муниципальный район",
    nameStem: "кулебакский",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111103",
    regionId: "22222222-2222-2222-2222-222222222201",
    regionIso: "RU-NIZ",
    kind: "district",
    name: "Навашинский муниципальный район",
    nameStem: "навашинский",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111104",
    regionId: "22222222-2222-2222-2222-222222222201",
    regionIso: "RU-NIZ",
    kind: "district",
    name: "Выксунский муниципальный район",
    nameStem: "выксунский",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111105",
    regionId: "33333333-3333-3333-3333-333333333301",
    regionIso: "RU-ROS",
    kind: "city",
    name: "Таганрог",
    nameStem: "таганрог",
    centroidLat: 47.22,
    centroidLon: 38.88,
  },
  {
    placeId: "11111111-1111-1111-1111-111111111106",
    regionId: "33333333-3333-3333-3333-333333333301",
    regionIso: "RU-ROS",
    kind: "region",
    name: "Ростовская область",
    nameStem: "ростовская",
    nameWithType: "Ростовская область",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111107",
    regionId: "44444444-4444-4444-4444-444444444401",
    regionIso: "RU-BRY",
    kind: "region",
    name: "Брянская область",
    nameStem: "брянская",
    nameWithType: "Брянская область",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111108",
    regionId: "44444444-4444-4444-4444-444444444401",
    regionIso: "RU-BRY",
    kind: "city",
    name: "Клинцы",
    nameStem: "клинцы",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111109",
    regionId: "55555555-5555-5555-5555-555555555501",
    regionIso: "RU-VOR",
    kind: "region",
    name: "Воронежская область",
    nameStem: "воронежская",
    nameWithType: "Воронежская область",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111110",
    regionId: "66666666-6666-6666-6666-666666666601",
    regionIso: "RU-SAR",
    kind: "region",
    name: "Саратовская область",
    nameStem: "саратовская",
    nameWithType: "Саратовская область",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111111",
    regionId: "77777777-7777-7777-7777-777777777701",
    regionIso: "RU-KIR",
    kind: "city",
    name: "Киров",
    nameStem: "киров",
  },
  {
    placeId: "11111111-1111-1111-1111-111111111112",
    regionId: "88888888-8888-8888-8888-888888888801",
    regionIso: "RU-KYA",
    kind: "city",
    name: "Киров",
    nameStem: "киров",
  },
];

export function buildTestPlaceScanService(
  entries: PlaceScanEntry[] = GF_P6_SCAN_ENTRIES,
): PlaceScanService {
  return new PlaceScanService(entries, "test-fixture");
}
