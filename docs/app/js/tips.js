/* Paycheck Weathervane: the "i" hover text. Each entry is [what it is, why it matters].
   Same voice as the lessons: describe, never direct. */
(function (g) {
'use strict';
g.VW.TIPS = {
  // dashboard
  nextPaycheck: ['The next day money lands in your account, and what that paycheck has to pay for.', 'Knowing the date and what it covers shows how long the money in your account has to last.'],
  untilThen: ['The payments from your current paycheck that you have not ticked as paid yet.', 'This is the money already spoken for before the next paycheck arrives.'],
  leftFromPaycheck: ['Your current paycheck minus every payment it covers, whether or not you have paid it yet.', 'It shows whether a paycheck is enough for what lands in its window, before you spend anything extra.'],
  glance: ['A summary of the month that your next paycheck falls in.', 'One month at a glance is easier to hold in your head than a list of dates.'],
  moneyIn: ['The total of the paychecks dated in this month.', 'A month can have two, three, or more paychecks, so this number changes from month to month.'],
  mustCover: ['Everything due from this month\'s paychecks until the next paycheck after them, including bills that come due early next month.', 'Each paycheck pays for the bills that come after it. This is the number that has to fit inside Money in.'],
  leftOver: ['Money in minus what those paychecks must cover.', 'It is the part of your pay not yet assigned. If it is negative, more is going out than is coming in.'],
  dueMonth: ['The bills whose due date falls inside this calendar month, no matter which paycheck pays them.', 'It matches how most people think about a month. It can differ from "They must cover" because paychecks and calendar months do not line up.'],
  donut: ['Each slice is a group of spending as a share of your take-home pay.', 'Seeing a share is often clearer than seeing dollars. It shows which parts of life take the most of each paycheck.'],
  comingUp: ['The next unpaid payments, in date order.', 'Dates are what trip people up. Ticking Paid keeps the "still to pay" total honest.'],
  bars: ['For each upcoming paycheck, a blue bar for the money in and an orange bar for what it has to pay.', 'It shows which paychecks are tight (orange close to blue) and which have room, even when the month adds up.'],
  goals: ['Money you are setting aside for something specific.', 'A target and a pace turn "someday" into a date you can see.'],
  debts: ['What you owe on cards and loans, with the interest rate and an estimate of the payoff date.', 'Interest is a cost that grows with the balance, so seeing balance and rate together shows what a debt costs over time.'],
  facts: ['Plain statements calculated from the numbers you entered.', 'They point at things that are easy to miss, like what subscriptions add up to in a year. They describe; they do not advise.'],
  yardsticks: ['Commonly quoted rules of thumb for how big a share of take-home pay a group takes.', 'A yardstick gives you something to measure against. Sources and places differ, so it measures but does not judge.'],
  split: ['A popular way to compare spending: about 50% needs, 30% wants, 20% savings.', 'It is one named framework. Many households land elsewhere, and that is common.'],
  // plan
  landed: ['A tick that says this paycheck has actually arrived in your account.', 'Paychecks can be late or different. Ticking it separates money you have from money you expect.'],
  leftAfter: ['The running amount left from the paycheck after each payment, in date order.', 'It shows the day money gets tight, not just whether the total works.'],
  early: ['Bills that come due before the first paycheck of this month, so the paycheck from the month before pays them.', 'It explains why a paycheck at the end of one month is already partly spent on the next month.'],
  modeDue: ['Shows each paycheck with exactly the bills that come due in its window.', 'This is what really leaves each paycheck, so it shows the true tight spots.'],
  modeEven: ['Shows what each paycheck would set aside if the month\'s payments were shared equally.', 'It is one common way to smooth out tight and roomy paychecks. The app shows it and does not pick it for you.'],
  estimatedChip: ['This paycheck amount is a typical figure, not a confirmed one.', 'If pay changes, the plan is only as good as the estimate until the money lands.'],
  paidEarly: ['This payment was moved to be paid from an earlier paycheck.', 'Paying from a different paycheck changes which paychecks are tight.'],
  oneTime: ['A payment that happens once, like a repair or a gift.', 'One-time costs are what throw off a month that otherwise looked fine.'],
  staleChip: ['This balance was entered a while ago.', 'New charges and interest change a balance, so older numbers become less reliable.'],
  // my money
  sec_pay: ['Your take-home pay: what lands in your account after taxes.', 'Everything in the app is measured against it, and paydays decide which paycheck covers which bill.'],
  sec_bills: ['What you pay on a schedule, like rent, utilities, insurance, and groceries.', 'Bills are due on dates, not paychecks. Entering the due date lets the app work out the paycheck for you.'],
  sec_subs: ['Charges that repeat until you cancel, like streaming and apps.', 'Small charges are easy to forget and add up over a year.'],
  sec_debts: ['Cards and loans, with what you owe, the interest rate, and your payment.', 'Part of every payment goes to interest. Entering the rate lets the app show how much.'],
  sec_goals: ['Money you set aside from each paycheck for something specific.', 'A goal that comes out of the paycheck like a bill shows what is left after it.'],
  sec_cash: ['One optional number: the money you have right now.', 'Questions like "can I cover this?" depend on what you have today.'],
  // forms
  pay: ['Take-home pay: what actually lands in your account after taxes and deductions.', 'Everything else in the app is measured against this number.'],
  payFreq: ['How often you are paid.', 'It decides how many paychecks there are in a month. Every 2 weeks is 26 a year, not 24.'],
  payDate: ['Any one payday, past or upcoming.', 'The app counts forward from it to find every other payday.'],
  estimated: ['A tick for pay that changes, like hours, tips, or commission.', 'It marks the paycheck as an estimate until you confirm it landed.'],
  billAmount: ['What the payment costs each time.', 'For a bill that changes, a typical amount works, and you can change any single payment later.'],
  billDate: ['The next date this is due.', 'The app repeats it and places it on the last paycheck that arrives before the due date.'],
  itemName: ['What you call this, for your own eyes.', 'It stays on this device. Reports use a generic label or the report name you choose instead.'],
  billFreq: ['How often this repeats.', 'A weekly bill lands on more paychecks than a monthly one, so the schedule changes the picture.'],
  group: ['The part of life this belongs to, such as Home or Auto.', 'Groups let the app show what share of your pay each part takes.'],
  aka: ['A name of your own to use in reports to Claude.', 'It keeps your real names out of the report. If it is blank, the report uses a generic label.'],
  debtBalance: ['What you owe right now, from your statement or app.', 'It changes with every payment and charge, so it goes out of date.'],
  apr: ['APR is the yearly cost of borrowing, as a percent.', 'It sets how much of each payment is interest. A 24% APR is about 2% a month.'],
  debtMin: ['The payment you plan to make each time.', 'The minimum is the least a lender accepts. A payment that barely covers interest pays the balance down very slowly.'],
  goalTarget: ['The total you want to reach.', 'A clear number lets the app work out the date.'],
  goalContribution: ['What you set aside from each paycheck.', 'It comes out like a bill, so you can see whether the paycheck can afford it.'],
  cash: ['The money you have right now, as one number.', 'It anchors questions about covering a cost. Leave account names and numbers out.'],
  // ask
  askChoose: ['The kind of question you want to look at.', 'Each question fills in the right numbers for you, so you do not have to know what to include.'],
  askDetails: ['The specifics of your question, like the amount and the date.', 'The calculations use exactly what you enter here.'],
  askNumbers: ['What your own numbers show for this question, calculated by the app.', 'You see the effect right away, and Claude gets the same figures, so the arithmetic is not left to chance.'],
  askReport: ['The text to paste into Claude: your numbers, your question, and instructions for how to answer.', 'Claude can only describe what is in the report, so it has to be complete and correct.'],
  askExtra: ['Words you want removed from your question, like names or places.', 'The app cannot know every private detail. This is one more step you control.'],
  review: ['A tick that says you read the whole report.', 'The scrub is best effort. Reading the report is the part that protects you.'],
  askKey: ['Which generic label in the report stands for which real name.', 'It lets you read Claude\'s answer in your own words. The key is never part of the report.'],
  // learn
  kind_fact: ['A definition or arithmetic that is true no matter who you are.', 'It tells you this part is not a matter of opinion.'],
  kind_framework: ['A named method that many people use, one choice among several.', 'It tells you this is a way to look at money, not the only way.'],
  kind_yardstick: ['A commonly quoted rule of thumb.', 'It tells you the numbers vary by source and place, and are for measuring, not judging.'],
  words: ['Plain definitions of money words used in the app.', 'Money words are a big reason money feels confusing.'],
  // data
  backup: ['A file with all your numbers, saved to your device.', 'Your data lives only in this browser, so clearing browser data erases it.'],
  aliases: ['Words you choose to always replace in your question.', 'It is an extra step of removing identifying details, set by you.'],
  coachMode: ['Turns the plain-English hint lines on or off.', 'Hints help when something is new. Turn them off once they are familiar.']
};
})(window);
