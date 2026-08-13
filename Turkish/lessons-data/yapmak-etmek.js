window.LC_LESSONS = window.LC_LESSONS || [];
window.LC_LESSONS.push({
  id: "yapmak-etmek",
  language: "Turkish",
  title: "Yapmak ve Etmek",
  short: "yapmak ve etmek",
  summary:
    "Two verbs that both mean ‘to do/make’. Yapmak goes with hands-on actions and creations; etmek tends to govern intangible, borrowed, or fixed expressions.",
  source: { code: "tr", label: "Turkish", dir: "ltr" },
  target: { code: "bn", label: "Bengali", dir: "ltr" },
  translate: { sl: "tr", tl: "en" },
  cards: [
    {
      id: "yemek-yapmak-1",
      expression: "Yemek yapmak",
      meaning: "to cook (prepare food)",
      meaningBn: "রান্না করা",
      verb: "yapmak",
      why:
        "Yemek (food/meal) is a native Turkish noun; yapmak pairs productively with everyday activity nouns.",
      groups: [
        { id: "g1", source: "Annem",    target: "আমার মা",   gloss: "my mother",
          suffix: "m", targetSuffix: "আমার", targetSuffixPos: 0,
          base: "anne", meaningBase: "মা", kind: "noun" },
        { id: "g2", source: "mutfakta", target: "রান্নাঘরে", gloss: "in the kitchen",
          suffix: "ta", targetSuffix: "রে",
          base: "mutfak", meaningBase: "রান্নাঘর", kind: "noun" },
        { id: "g3", source: "yemek",    target: "রান্না",     gloss: "the food / cooking",
          base: "yemek", meaningBase: "রান্না / খাবার", kind: "noun" },
        { id: "g4", source: "yapıyor",  target: "করছেন",     gloss: "is doing (3rd person, present)",
          suffix: "yor", targetSuffix: "ছেন",
          base: "yapmak", meaningBase: "করা / করানো", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "odev-yapmak-2",
      expression: "Ödev yapmak",
      meaning: "to do homework",
      meaningBn: "বাড়ির কাজ করা",
      verb: "yapmak",
      why:
        "Ödev (homework) is a native activity noun; yapmak signals ‘to perform an activity’.",
      groups: [
        { id: "g1", source: "Çocuklar", target: "বাচ্চারা",   gloss: "the children",
          suffix: "lar", targetSuffix: "রা",
          base: "çocuk", meaningBase: "বাচ্চা / শিশু", kind: "noun" },
        { id: "g2", source: "akşam",    target: "সন্ধ্যায়",   gloss: "in the evening",
          base: "akşam", meaningBase: "সন্ধ্যা", kind: "noun" },
        { id: "g3", source: "ödev",     target: "বাড়ির কাজ", gloss: "homework",
          base: "ödev", meaningBase: "বাড়ির কাজ", kind: "noun" },
        { id: "g4", source: "yapıyor",  target: "করছে",       gloss: "are doing (3rd person plural)",
          suffix: "yor", targetSuffix: "ছে",
          base: "yapmak", meaningBase: "করা / করানো", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "spor-yapmak-3",
      expression: "Spor yapmak",
      meaning: "to exercise / work out",
      meaningBn: "ব্যায়াম করা",
      verb: "yapmak",
      why:
        "Spor (sports/exercise) is a native or well-nativized activity noun; yapmak is the productive choice.",
      groups: [
        { id: "g1", source: "Her sabah", target: "প্রতি সকালে", gloss: "every morning",
          base: "sabah", meaningBase: "সকাল", kind: "noun" },
        { id: "g2", source: "spor",      target: "ব্যায়াম",     gloss: "exercise / sport",
          base: "spor", meaningBase: "ব্যায়াম / খেলাধুলা", kind: "noun" },
        { id: "g3", source: "yapıyorum", target: "করি",         gloss: "I do (1st person, present)",
          suffix: "yorum", targetSuffix: "রি",
          base: "yapmak", meaningBase: "করা / করানো", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "cay-yapmak-4",
      expression: "Çay yapmak",
      meaning: "to make tea",
      meaningBn: "চা বানানো",
      verb: "yapmak",
      why:
        "Çay (a loanword) has been nativized enough that yapmak works naturally with it.",
      groups: [
        { id: "g1", source: "Biraz",     target: "একটু",       gloss: "a little",
          base: "biraz", meaningBase: "একটু / কিছুটা", kind: "noun" },
        { id: "g2", source: "çay",       target: "চা",         gloss: "tea",
          base: "çay", meaningBase: "চা", kind: "noun" },
        { id: "g3", source: "yapayım mı", target: "বানাবো",    gloss: "shall I make? (1st person, question)",
          suffix: "ayım mı", targetSuffix: "বো",
          base: "yapmak", meaningBase: "করা / বানানো", kind: "verb" }
      ],
      unpaired: { source: ["?"], target: ["?"] }
    },
    {
      id: "resim-yapmak-5",
      expression: "Resim yapmak",
      meaning: "to draw / make a picture",
      meaningBn: "ছবি আঁকা",
      verb: "yapmak",
      why:
        "Resim (picture) is a concrete, hands-on activity; yapmak fits the ‘make something tangible’ pattern.",
      groups: [
        { id: "g1", source: "Küçük kız", target: "ছোট মেয়েটি", gloss: "the little girl",
          base: "kız", meaningBase: "মেয়ে", kind: "noun" },
        { id: "g2", source: "resim",     target: "ছবি",        gloss: "a picture / drawing",
          base: "resim", meaningBase: "ছবি / ছবি আঁকা", kind: "noun" },
        { id: "g3", source: "yapmayı",   target: "আঁকতে",      gloss: "to draw (verbal noun)",
          suffix: "mayı", targetSuffix: "তে",
          base: "yapmak", meaningBase: "করা / আঁকা", kind: "verb" },
        { id: "g4", source: "seviyor",   target: "ভালোবাসে",   gloss: "loves (3rd person)",
          suffix: "yor", targetSuffix: "সে",
          base: "sevmek", meaningBase: "ভালোবাসা", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "tesekkur-etmek-6",
      expression: "Teşekkür etmek",
      meaning: "to thank / give thanks",
      meaningBn: "ধন্যবাদ দেওয়া",
      verb: "etmek",
      why:
        "Teşekkür is an Arabic loan; the yap-/et- pairing is fixed by tradition.",
      groups: [
        { id: "g1", source: "Çok",      target: "আপনাকে অনেক", gloss: "very much (formal intensifier)",
          base: "çok", meaningBase: "অনেক / খুব", kind: "noun" },
        { id: "g2", source: "teşekkür", target: "ধন্যবাদ",     gloss: "thanks (n.)",
          base: "teşekkür", meaningBase: "ধন্যবাদ", kind: "noun" },
        { id: "g3", source: "ederim",   target: "দিচ্ছি",       gloss: "I give (1st person, polite)",
          suffix: "erim", targetSuffix: "চ্ছি",
          base: "etmek", meaningBase: "করা / দেওয়া", kind: "verb" }
      ],
      unpaired: { source: ["!"], target: ["!"] }
    },
    {
      id: "yardim-etmek-7",
      expression: "Yardım etmek",
      meaning: "to help",
      meaningBn: "সাহায্য করা",
      verb: "etmek",
      why:
        "Yardım (help, Arabic loan) takes etmek in the conventional phrase.",
      groups: [
        { id: "g1", source: "Arkadaşıma", target: "আমার বন্ধুকে", gloss: "to my friend (dative)",
          suffix: "a", targetSuffix: "কে",
          base: "arkadaş", meaningBase: "বন্ধু", kind: "noun" },
        { id: "g2", source: "yardım",     target: "সাহায্য",     gloss: "help (n.)",
          base: "yardım", meaningBase: "সাহায্য", kind: "noun" },
        { id: "g3", source: "ediyorum",   target: "করছি",       gloss: "I am doing (1st person)",
          suffix: "iyorum", targetSuffix: "ছি",
          base: "etmek", meaningBase: "করা / সাহায্য করা", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "telefon-etmek-8",
      expression: "Telefon etmek",
      meaning: "to make a phone call",
      meaningBn: "ফোন করা",
      verb: "etmek",
      why:
        "Telefon is a borrowed noun; the conventional pairing is telefon etmek, not telefon yapmak.",
      groups: [
        { id: "g1", source: "Yarın",   target: "আগামীকাল", gloss: "tomorrow",
          base: "yarın", meaningBase: "আগামীকাল", kind: "noun" },
        { id: "g2", source: "sana",    target: "তোমাকে",   gloss: "to you",
          base: "sen", meaningBase: "তুমি / আপনি", kind: "noun" },
        { id: "g3", source: "telefon", target: "ফোন",      gloss: "a phone call",
          base: "telefon", meaningBase: "ফোন / টেলিফোন", kind: "noun" },
        { id: "g4", source: "ederim",  target: "করব",      gloss: "I will make (1st person, future)",
          suffix: "erim", targetSuffix: "ব",
          base: "etmek", meaningBase: "করা / ফোন করা", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "randevu-etmek-9",
      expression: "Randevu etmek",
      meaning: "to make an appointment",
      meaningBn: "অ্যাপয়েন্টমেন্ট করা",
      verb: "etmek",
      why:
        "Randevu is a loanword; the fixed light verb is etmek.",
      groups: [
        { id: "g1", source: "Doktorla", target: "ডাক্তারের সাথে", gloss: "with the doctor",
          suffix: "la", targetSuffix: "সাথে",
          base: "doktor", meaningBase: "ডাক্তার", kind: "noun" },
        { id: "g2", source: "randevu",  target: "অ্যাপয়েন্টমেন্ট", gloss: "an appointment",
          base: "randevu", meaningBase: "অ্যাপয়েন্টমেন্ট / সাক্ষাৎ", kind: "noun" },
        { id: "g3", source: "ettim",    target: "করেছি",            gloss: "I made (1st person, past)",
          suffix: "tim", targetSuffix: "ছি",
          base: "etmek", meaningBase: "করা / অ্যাপয়েন্টমেন্ট করা", kind: "verb" }
      ],
      unpaired: { source: ["."], target: ["।"] }
    },
    {
      id: "merak-etmek-10",
      expression: "Merak etmek",
      meaning: "to worry / to be curious",
      meaningBn: "চিন্তা করা / কৌতূহল বোধ করা",
      verb: "etmek",
      why:
        "Merak is an Arabic loan; merak etmek is the fixed idiom. Merak yapmak is ungrammatical.",
      groups: [
        { id: "g1", source: "Merak",     target: "চিন্তা",     gloss: "worry / concern",
          base: "merak", meaningBase: "চিন্তা / কৌতূহল", kind: "noun" },
        { id: "g2", source: "etme",      target: "করো না",     gloss: "do not (2nd person, imperative)",
          suffix: "me", targetSuffix: "না",
          base: "etmek", meaningBase: "করা", kind: "verb" },
        { id: "g3", source: "hallederiz", target: "আমরা সামলে নেব", gloss: "we will handle it (1st person plural, future)",
          base: "halletmek", meaningBase: "সামলানো / সমাধান করা", kind: "verb" }
      ],
      unpaired: { source: ["!"], target: ["!"] }
    }
  ]
});