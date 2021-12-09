// taken from here https://stackoverflow.com/a/57102881

function weekStart(
  region: string,
  language: string,
): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const regionSat = 'AEAFBHDJDZEGIQIRJOKWLYOMQASDSY'.match(
    /../g,
  ) as RegExpMatchArray;

  const regionSun =
    'AGARASAUBDBRBSBTBWBZCACNCODMDOETGTGUHKHNIDILINJMJPKEKHKRLAMHMMMOMTMXMZNINPPAPEPHPKPRPTPYSASGSVTHTTTWUMUSVEVIWSYEZAZW'.match(
      /../g,
    ) as RegExpMatchArray;

  const languageSat = ['ar', 'arq', 'arz', 'fa'];

  const languageSun =
    'amasbndzengnguhehiidjajvkmknkolomhmlmrmtmyneomorpapssdsmsnsutatethtnurzhzu'.match(
      /../g,
    ) as RegExpMatchArray;

  return region
    ? regionSun.includes(region)
      ? 0
      : regionSat.includes(region)
      ? 6
      : 1
    : languageSun.includes(language)
    ? 0
    : languageSat.includes(language)
    ? 6
    : 1;
}

export function weekStartLocale(locale: string) {
  const parts = locale.match(
    /^([a-z]{2,3})(?:-([a-z]{3})(?=$|-))?(?:-([a-z]{4})(?=$|-))?(?:-([a-z]{2}|\d{3})(?=$|-))?/i,
  ) as RegExpMatchArray;
  return weekStart(parts[4] as string, parts[1] as string);
}
