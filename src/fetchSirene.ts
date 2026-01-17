import axios from "axios";
import * as dotenv from "dotenv";
import { promises as fs } from "fs";
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

const OUTPUT_FILE_STANDARD = path.resolve(
  process.cwd(),
  `etablissements-${getTodayStamp()}.json`,
);
const OUTPUT_FILE_EI = path.resolve(
  process.cwd(),
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

const SIRENE_API_KEY =
  process.env.SIRENE_API_KEY ?? process.env.SIRENE_API_TOKEN;

if (!SIRENE_API_KEY) {
  console.error(
    "Please set the SIRENE_API_KEY (or legacy SIRENE_API_TOKEN) environment variable before running the script.",
  );
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
    console.log(
      `[${label}] Page ${page} | curseur=${cursor} | +${count} etablissements`,
    );

    if (count === 0) {
      console.warn("No more records returned by the API.");
      break;
    }

    allEtablissements.push(...etablissements);

    if (!header?.curseurSuivant || header.curseurSuivant === cursor) {
      console.log("Reached the last page.");
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
  await fs.writeFile(outputFile, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Saved ${data.length} etablissements to ${outputFile}`);
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
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Request failed with status", error.response?.status);
      console.error(error.response?.data ?? error.message);
    } else {
      console.error("Unexpected error", error);
    }
    process.exit(1);
  }
}

void main();
