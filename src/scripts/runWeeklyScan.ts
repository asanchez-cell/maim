/**
 * Разовый запуск еженедельной проверки дублей — вызывается из
 * .github/workflows/weekly-duplicate-scan.yml по расписанию (воскресенье).
 */
import { runWeeklyDuplicateScan } from "../engine/weeklyDuplicateScan";
import { logger } from "../logger";

runWeeklyDuplicateScan()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error("Еженедельный скан дублей прерван ошибкой", { err: String(err) });
    process.exit(1);
  });
