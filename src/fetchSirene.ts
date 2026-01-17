import axios from "axios";
import { spawn } from "child_process";
import * as dotenv from "dotenv";
import * as fsSync from "fs";
import { promises as fs } from "fs";
import * as nodemailer from "nodemailer";
import * as path from "path";

dotenv.config();

interface SireneHeader {
  statut: number;
  message: string;
  total: number;
  debut: number;
  nombre: number;
  curseur: string;
  curseurSuivant: string;
}

interface SireneResponse {
  header: SireneHeader;
  etablissements: Establishment[];
}

type Establishment = Record<string, unknown>;

const formatLog = (level: string, message: string): string =>
  `${new Date().toISOString()} [${level}] ${message}`;

const appendLog = async (level: string, message: string): Promise<void> => {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(LOG_FILE, formatLog(level, message) + "\n", "utf-8");
};

const appendLogSync = (level: string, message: string): void => {
  fsSync.mkdirSync(LOG_DIR, { recursive: true });
  fsSync.appendFileSync(LOG_FILE, formatLog(level, message) + "\n", "utf-8");
};

const logInfo = async (message: string): Promise<void> => {
  console.log(message);
  await appendLog("INFO", message);
};

const logWarn = async (message: string): Promise<void> => {
  console.warn(message);
  await appendLog("WARN", message);
};

const logError = async (message: string): Promise<void> => {
  console.error(message);
  await appendLog("ERROR", message);
};

const API_BASE_URL = "https://api.insee.fr/api-sirene/3.11";
const SIRET_ENDPOINT = "/siret";
const getTodayStamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateDaysAgoStamp = (daysAgo: number): string => {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const LAST_WEEK_START = getDateDaysAgoStamp(7);

const OUTPUT_DIR = path.resolve(process.cwd(), "result");
const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.resolve(LOG_DIR, `run-${getTodayStamp()}.txt`);
const OUTPUT_FILE_STANDARD = path.resolve(
  OUTPUT_DIR,
  `etablissements-${getTodayStamp()}.json`,
);
const OUTPUT_FILE_EI = path.resolve(
  OUTPUT_DIR,
  `etablissements-ei-${getTodayStamp()}.json`,
);
const REQUEST_INTERVAL_MS = 4_000; // pause between pages to avoid rate limiting in milliseconds (0 = no pause)

/**
 * Update the query below to match your needs. Add, remove, or modify any key/value
 * pairs so the request exactly mirrors the parameters you usually send in Postman.
 */
const QUERY_PARAMS: Record<string, string | number | boolean> = {
  q: `dateCreationEtablissement:[${LAST_WEEK_START} TO *] AND dateCreationUniteLegale:[${LAST_WEEK_START} TO *] AND -categorieJuridiqueUniteLegale:1000 AND periode(activitePrincipaleEtablissement:85.59A OR activitePrincipaleEtablissement:85.59B) AND etablissementSiege:true`,
  champs:
    "siren,nic,siret,dateCreationUniteLegale,dateCreationEtablissement,etablissementSiege,numeroVoieEtablissement,codePostalEtablissement,libelleVoieEtablissement,typeVoieEtablissement,libelleCommuneEtablissement,sexeUniteLegale,prenomUsuelUniteLegale,nomUniteLegale,denominationUniteLegale,activitePrincipaleEtablissement,categorieJuridiqueUniteLegale",
  nombre: 200, // maximum rows returned per page (<=200)
  // Add additional params here if needed, e.g. 'debut': 0
};

const QUERY_PARAMS_EI: Record<string, string | number | boolean> = {
  q: `dateCreationEtablissement:[${LAST_WEEK_START} TO *] AND dateCreationUniteLegale:[${LAST_WEEK_START} TO *] AND categorieJuridiqueUniteLegale:1000 AND periode(activitePrincipaleEtablissement:85.59A OR activitePrincipaleEtablissement:85.59B) AND etablissementSiege:true`,
  champs:
    "siren,nic,siret,dateCreationUniteLegale,dateCreationEtablissement,etablissementSiege,numeroVoieEtablissement,codePostalEtablissement,libelleVoieEtablissement,typeVoieEtablissement,libelleCommuneEtablissement,sexeUniteLegale,prenomUsuelUniteLegale,nomUniteLegale,denominationUniteLegale,activitePrincipaleEtablissement,categorieJuridiqueUniteLegale",
  nombre: 200, // maximum rows returned per page (<=200)
  // Add additional params here if needed, e.g. 'debut': 0
};

const normalizeEnv = (value?: string): string | undefined =>
  value?.trim() || undefined;

const SIRENE_API_KEY =
  normalizeEnv(process.env.SIRENE_API_KEY) ??
  normalizeEnv(process.env.SIRENE_API_TOKEN);

if (!SIRENE_API_KEY) {
  const message =
    "Please set the SIRENE_API_KEY (or legacy SIRENE_API_TOKEN) environment variable before running the script.";
  console.error(message);
  appendLogSync("ERROR", message);
  process.exit(1);
}

const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: {
    "X-INSEE-Api-Key-Integration": SIRENE_API_KEY,
    Accept: "application/json",
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAIL_FROM = "scraper.logpro@gmail.com";
const MAIL_TO =
  normalizeEnv(process.env.MAIL_TO) ??
  "contact@organismes-certifies.fr;contact@valentin-lerouge.fr";
const MAIL_SUBJECT = `Export Sirene ${getTodayStamp()}`;

const mailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "scraper.logpro@gmail.com",
    pass: "ryop uslc xnbp apvh",
  },
});

const PY_ENRICH_REPO = normalizeEnv(process.env.PY_ENRICH_REPO);
const PY_ENRICH_OUTPUT_DIR = normalizeEnv(process.env.PY_ENRICH_OUTPUT_DIR);
const PY_ENRICH_OUTPUT_FORMAT =
  normalizeEnv(process.env.PY_ENRICH_OUTPUT_FORMAT) ?? "excel";

const runPythonEnrichment = async (inputFile: string): Promise<string> => {
  if (!PY_ENRICH_REPO) {
    throw new Error("Missing PY_ENRICH_REPO environment variable.");
  }
  if (!PY_ENRICH_OUTPUT_DIR) {
    throw new Error("Missing PY_ENRICH_OUTPUT_DIR environment variable.");
  }

  const repoPath = path.resolve(PY_ENRICH_REPO);
  const outputDir = path.resolve(PY_ENRICH_OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });
  const outputExt = PY_ENRICH_OUTPUT_FORMAT === "excel" ? "xlsx" : "json";
  const outputBaseName = path.basename(inputFile, path.extname(inputFile));
  const outputFile = path.resolve(outputDir, `${outputBaseName}.${outputExt}`);
  const args = [
    "main.py",
    "--input-format",
    "json",
    "--input-file",
    inputFile,
    "--output-format",
    PY_ENRICH_OUTPUT_FORMAT,
    "--output-file",
    outputFile,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("python", args, {
      cwd: repoPath,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(outputFile);
        return;
      }
      reject(new Error(`Python enrichment failed with exit code ${code}`));
    });
  });
};

async function sendResultsByEmail(
  standardFile: string,
  eiFile: string,
): Promise<void> {
  await mailTransporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    subject: MAIL_SUBJECT,
    text: "Exports Sirene enrichis en pieces jointes.",
    attachments: [
      {
        filename: path.basename(standardFile),
        path: standardFile,
      },
      {
        filename: path.basename(eiFile),
        path: eiFile,
      },
    ],
  });
  await logInfo(`Email sent to ${MAIL_TO}`);
}

async function fetchPage(
  cursor: string,
  queryParams: Record<string, string | number | boolean>,
): Promise<SireneResponse> {
  const params = { ...queryParams, curseur: cursor };
  const response = await httpClient.get<SireneResponse>(SIRET_ENDPOINT, {
    params,
  });
  return response.data;
}

async function fetchAllEtablissements(
  queryParams: Record<string, string | number | boolean>,
  label: string,
): Promise<Establishment[]> {
  let cursor = "*";
  const allEtablissements: Establishment[] = [];
  let page = 0;

  while (true) {
    const { header, etablissements } = await fetchPage(cursor, queryParams);
    const count = etablissements?.length ?? 0;
    await logInfo(
      `[${label}] Page ${page} | curseur=${cursor} | +${count} etablissements`,
    );

    if (count === 0) {
      await logWarn("No more records returned by the API.");
      break;
    }

    allEtablissements.push(...etablissements);

    if (!header?.curseurSuivant || header.curseurSuivant === cursor) {
      await logInfo("Reached the last page.");
      break;
    }

    cursor = header.curseurSuivant;
    page += 1;
    if (REQUEST_INTERVAL_MS > 0) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  return allEtablissements;
}

async function saveResultsToFile(
  data: Establishment[],
  outputFile: string,
): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(data, null, 2), "utf-8");
  await logInfo(`Saved ${data.length} etablissements to ${outputFile}`);
}

async function main(): Promise<void> {
  try {
    const etablissements = await fetchAllEtablissements(
      QUERY_PARAMS,
      "standard",
    );
    const etablissementsEi = await fetchAllEtablissements(
      QUERY_PARAMS_EI,
      "auto-entreprise",
    );
    await saveResultsToFile(etablissements, OUTPUT_FILE_STANDARD);
    await saveResultsToFile(etablissementsEi, OUTPUT_FILE_EI);
    const enrichedStandard = await runPythonEnrichment(OUTPUT_FILE_STANDARD);
    const enrichedEi = await runPythonEnrichment(OUTPUT_FILE_EI);
    await sendResultsByEmail(enrichedStandard, enrichedEi);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      await logError(
        `Request failed with status ${String(error.response?.status ?? "")}`.trim(),
      );
      await logError(String(error.response?.data ?? error.message));
    } else {
      await logError(`Unexpected error ${String(error)}`);
    }
    process.exit(1);
  }
}

void main();
