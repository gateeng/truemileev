// TrueMile EV web: the launch copy, in ONE place. Pure; no DOM.
// The product page (assets/site.js) and the dashboard's plan table (lib/plans.js) both read these, so a
// change of wording, price, trial length or supported vehicle is made here and nowhere else.
//
// Launch decisions (owner, 2026-09-28):
//  - Only the Ford F-150 Lightning is named and supported on Oct 1; every other EV is "coming soon".
//  - Pro $5.99 / month or $59.99 / year, Max $10.99 / month or $99.99 / year (US Google Play prices; the
//    app itself reads prices from Play at run time and never hardcodes them - only this web page does).
//  - 14-day Max trial. The entry plan is called "Basic" (never the other word: the app is paid).
//  - Launch price guarantee (owner decision 9/29; it REPLACES the earlier "first 10 owners of each vehicle
//    type" offer, which was never switched on - app_config.founder_enabled stays false and nothing grants
//    from its tables): subscribe to Pro or Max on or before December 31, 2026 and the price does not go
//    up while that subscription stays active. How it is kept (owner, not code): SEPARATE LAUNCH BASE
//    PLANS. The four launch base plans (pro-monthly, pro-annual, max-monthly, max-annual) are never
//    repriced; on Jan 1, 2027 (10:00 UTC or later) pro/max-2027-monthly/-annual open at the same prices,
//    the launch plans are deactivated with Resubscribe off (pause stays off), and any later raise is on
//    the 2027 plans only (docs/PLAY_LAUNCH_RUNBOOK.md, Price increases). The terms page
//    (web/legal/truemile-terms) says the same.
//  - Owner update 9/29: the Wear OS watch app ships WITH the phone app on launch day (production release
//    alongside, wear 1101), and Android Auto ships with the charging features only (the production car
//    build, CAR_FULL_SCOPE=false: charging locations, bookmarks, a station's details, navigation and the
//    live charging screen; no car live dashboard, journeys or vehicle switch). Nothing is "coming soon"
//    except other EVs, and those have a volunteer beta (the product page's #beta section).
// The internal accounting words never appear here (web/tests/wording_test.js checks every file).

export const BUILD = "2026-09-30.2";

/** The support address (mailto only; the page itself sends nothing anywhere). */
export const SUPPORT_EMAIL = "support@gateeng.com";

/** The last day a new Pro or Max subscription gets the launch price guarantee. */
const GUARANTEE_DEADLINE = "December 31, 2026";

export const LAUNCH = Object.freeze({
  /** The public launch on Google Play. */
  launchDate: "October 1, 2026",

  /** The vehicles the app reads on launch day, by name. */
  vehicles: Object.freeze(["Ford F-150 Lightning"]),
  /** One line for "which car": the product page, the adapters page. */
  worksWith: "Works with the Ford F-150 Lightning.",
  /** Everything else (vehicle/VehicleSupport.kt: every unverified car is COMING_SOON and its drives are
   *  logged by GPS only). */
  comingSoon: "Other EVs are coming soon. Until then, TrueMile logs their drives by GPS only.",
  /** The beta hint for owners of other EVs: a link to the product page's #beta section. */
  betaHint: "Drive a different EV? Join the beta.",
  /** The beta sign-up email's subject (owner 9/29: exactly this). */
  betaSubject: "TrueMile beta",

  /** The volunteer beta for EVs other than the Lightning (product page, section id="beta"). */
  beta: Object.freeze({
    title: "Beta for other EVs",
    what: "Early builds of TrueMile EV for EVs other than the Ford F-150 Lightning. A model is supported only after it has been proven on a real car, and the beta is how that happens.",
    /** Who can join: the models the app's vehicle list already carries, and any other EV. */
    models: Object.freeze(["Ford Mustang Mach-E", "Hyundai Ioniq 5", "Hyundai Ioniq 6", "Hyundai Kona Electric",
      "Kia EV6", "Kia Niro EV", "Chevrolet Bolt", "Nissan Leaf"]),
    whoTail: "or of another EV, with a classic Bluetooth OBD-II adapter (the Vgate vLinker MC+ is the one we test on).",
    steps: Object.freeze([
      "Email us with the button below: your car's model and year, your adapter, and the Google account email you use on Google Play.",
      // Channel-neutral on purpose (review 9/29): the Test session card is compiled into DEBUG builds only
      // (app ui/DiagTab.kt, `if (BuildConfig.DEBUG)`), so a release bundle on a Play testing track does not
      // have it. "The test build" is true for whichever build the owner sends until that is decided.
      "We send you a link to an early test build. Install TrueMile EV from that link.",
      "Record one test drive and one charge with the test build's Test session, then send us the file it makes.",
    ]),
    fileNote: "The file carries your car's VIN, its readings from the test, any trouble codes and that day's drive log. Send it only to our support address; we use it to build support for your model.",
    gets: Object.freeze([
      // One item since 9/29: the "first owners of your model get Max for life" line went with that offer.
      "Max while you test.",
    ]),
    cta: "Email us to join",
    /** The sign-up email's body: a template the reader fills in (nothing about them is prefilled). */
    body: [
      "Hi TrueMile team,",
      "",
      "I'd like to join the beta.",
      "",
      "Car model and year: ",
      "OBD-II adapter (make and model): ",
      "Google account email I use on Google Play: ",
      "",
      "Thanks!",
    ].join("\r\n"),     // RFC 6068: a mailto body's line breaks are CRLF (%0D%0A once encoded)
  }),

  /** The web dashboard (app.html): what it offers, and how to get in. Every line rests on the dashboard's
   *  own code: the sidebar (assets/app.js SECTIONS), the plan gates that mirror the app (lib/gates.js),
   *  Report's print and CSV exports (views/report.js), the read-only request gate and Account's delete
   *  (lib/api.js), and the sign-in panel with its password reset (app.html). */
  dashboard: Object.freeze({
    title: "Web dashboard",
    what: "Your drives, charges, costs and maps on a bigger screen: Account, Garage, Financial, Charge, Map and Report, with printable reports and CSV downloads. Your plan's features are the same as in the app.",
    signIn: "Sign in with your TrueMile account: Google or email, the same one you use in the app. Forgot the password? The sign-in page emails you a code to set a new one.",
    // lib/api.js: the only writes are the reset's new password (ALLOWED's one user-path write) and the
    // delete_account call; every table stays read-only.
    readOnly: "The dashboard reads your data; corrections to drives and charges stay in the app. The only changes it can make are a new password, from Forgot password, and deleting your account, from Account.",
    href: "app.html",
    cta: "Open the web dashboard",
  }),

  /** The recommended adapters (classic Bluetooth only - the app has no BLE transport). The vLinker MC+ is the
   *  one the app is developed and tested on; the MX+ is listed on its specs and its note SAYS it is untested
   *  (the same words as the app's own adapter list, app/src/main/assets/vehicles.json). */
  adapters: Object.freeze([
    Object.freeze({ name: "Vgate vLinker MC+", note: "The adapter we develop and test on. Pair it in Android's Bluetooth settings (classic Bluetooth), then pick it in the app." }),
    Object.freeze({ name: "OBDLink MX+", note: "Classic Bluetooth, with Ford's MS-CAN network built in. It should work, but we have not tested one ourselves yet." }),
  ]),
  adapterRule: "Classic Bluetooth adapters only. Bluetooth Low Energy (BLE-only) and Wi-Fi adapters do not connect.",

  /** Android Auto, as the production build ships it (owner decision 9/29: the charging features, the
   *  live charging screen included - auto/CarScope.kt with CAR_FULL_SCOPE=false; the menu rows are
   *  auto/poi/PoiScreens.kt's Charging Locations, Bookmarks and, while charging, Charging). */
  androidAuto: "Android Auto: charging locations, bookmarks, station details, navigation and the live charging screen",
  /** The watch, as it ships (owner 9/29: on Google Play with the phone app). What the watch shows is
   *  wear/MainActivity.kt's cards (battery and range, today, lifetime, Find My Car) and the charging face. */
  watch: "Wear OS watch app: battery and range, today's drives, the charge in progress and Find My Car",
  /** The product page marks a screen "soon" while it is not on the Play Store. Both ship on launch day. */
  autoSoon: false,
  watchSoon: false,

  /** The trial. */
  trialDays: 14,
  trialTier: "Max",

  /** The entry plan's user-facing name. */
  entryPlan: "Basic",

  /** US Google Play prices, as shown on the web only. */
  prices: Object.freeze({
    pro: Object.freeze({ monthly: "$5.99", yearly: "$59.99" }),
    max: Object.freeze({ monthly: "$10.99", yearly: "$99.99" }),
  }),
  priceNote: "US prices. Google Play shows the price in your currency before you buy, and the subscription renews until you cancel it in Google Play.",

  /** The launch price guarantee (for everyone who subscribes by the deadline). The terms page repeats the
   *  deadline and web/tests/launch_test.js checks the two agree. */
  guarantee: Object.freeze({
    title: "Launch price guarantee",
    deadline: GUARANTEE_DEADLINE,
    summary: `Subscribe to Pro or Max on or before ${GUARANTEE_DEADLINE}, and your price won't go up for as long as that subscription stays active.`,
    rules: Object.freeze([
      "If it ends (for example, you cancel and the paid period runs out) and you subscribe again later, the price at that time applies.",
      "Restoring a cancelled subscription in Google Play before it ends keeps it active.",
    ]),
    fine: "Taxes and currency conversion are handled by Google Play.",
  }),
});

/** "$5.99 a month or $59.99 a year" for "pro" / "max"; "" for any other plan. */
export function priceLine(plan) {
  const p = LAUNCH.prices[String(plan || "").toLowerCase()];
  return p ? `${p.monthly} a month or ${p.yearly} a year` : "";
}

/** The launch price guarantee as one paragraph (the dashboard's Account → Plan card). */
export function guaranteeLine() {
  const g = LAUNCH.guarantee;
  return `${g.title}: ${g.summary} ${g.rules.join(" ")} ${g.fine}`;
}

/** "Try every Max feature for 14 days." */
export const trialLine = () => `Try every ${LAUNCH.trialTier} feature for ${LAUNCH.trialDays} days.`;

/**
 * The beta sign-up mailto: link: the support address, the subject and the body template. Nothing about
 * the reader is prefilled; the blanks are theirs to fill in their own mail app.
 */
export const betaMailto = () => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(LAUNCH.betaSubject)}` +
  `&body=${encodeURIComponent(LAUNCH.beta.body)}`;

/** "Owners of a Ford Mustang Mach-E, Hyundai Ioniq 5, ... or Nissan Leaf, or of another EV, with a classic ..." */
export function betaWho() {
  const m = LAUNCH.beta.models;
  return `Owners of a ${m.slice(0, -1).join(", ")} or ${m[m.length - 1]}, ${LAUNCH.beta.whoTail}`;
}

/**
 * The text for every [data-launch="key"] element of the product page and the adapters page
 * (assets/launch-page.js fills them). A key missing here leaves the element empty, so the web tests
 * check every key the pages use against this map.
 */
export function launchText() {
  return {
    launchDate: LAUNCH.launchDate,
    onPlay: `On Google Play from ${LAUNCH.launchDate}.`,
    worksWith: LAUNCH.worksWith,
    comingSoon: LAUNCH.comingSoon,
    betaHint: LAUNCH.betaHint,
    betaTitle: LAUNCH.beta.title,
    betaWhat: LAUNCH.beta.what,
    betaWho: betaWho(),
    betaFileNote: LAUNCH.beta.fileNote,
    betaCta: LAUNCH.beta.cta,
    dashTitle: LAUNCH.dashboard.title,
    dashWhat: LAUNCH.dashboard.what,
    dashSignIn: LAUNCH.dashboard.signIn,
    dashReadOnly: LAUNCH.dashboard.readOnly,
    dashCta: LAUNCH.dashboard.cta,
    vehicles: LAUNCH.vehicles.join(", "),
    carNeed: `${LAUNCH.vehicles.join(" or ")}. ${LAUNCH.comingSoon}`,
    adapters: LAUNCH.adapters.map((a) => a.name).join(" or "),
    adapterRule: LAUNCH.adapterRule,
    auto: `${LAUNCH.androidAuto} (Max).`,
    watch: `${LAUNCH.watch} (Max).`,
    trial: `${trialLine()} No card needed; afterwards the account moves to ${LAUNCH.entryPlan} unless you choose Pro or Max.`,
    priceNote: LAUNCH.priceNote,
  };
}

/**
 * The three plans for the product page: [{key, name, price, blurb, items}].
 * Basic lists what it keeps; Pro and Max list what they add (plans.js has the full feature table).
 */
export function planCards() {
  return [
    {
      // The app is sold as a paid app: Basic is where an account lands after the trial, not a price.
      key: "basic", name: LAUNCH.entryPlan, price: "After the trial",
      blurb: "Every drive and charge is recorded and kept, on every plan.",
      items: [
        "Live dashboard, range and cost per mile",
        "Your last 50 drives and last 10 charges on screen",
        "Route maps, the charger map and the trouble-code reader",
        "One vehicle, and a download of your data at any time",
      ],
    },
    {
      key: "pro", name: "Pro", price: priceLine("pro"),
      blurb: "The detail behind every drive and charge.",
      items: [
        "Full drive detail and drive categories",
        "Money saved compared with gas",
        "Widgets, formatted CSV and PDF reports",
        "Restore your history on a new phone, towing mode",
        "Up to 2 vehicles and the last 6 months on screen",
      ],
    },
    {
      key: "max", name: "Max", price: priceLine("max"),
      blurb: "Everything, with no window on your history.",
      items: [
        "Everything in Pro",
        "Your learned DC charging curve and battery health over time",
        "Verifiable business-mileage PDF and a monthly recap",
        "Journeys: group a road trip and export it",
        LAUNCH.androidAuto,
        LAUNCH.watch,
        "Unlimited vehicles and your whole history",
      ],
    },
  ];
}
