import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Race = {
  position: number;
  pointsGiven: number;
  penaltyPoints: number | null;
  pointsTotal: number;
  dnf: boolean;
  dns: boolean;
};

type Standing = {
  position: number;
  id: string;
  carNum: number;
  car: string;
  championshipPoints: number;
  championshipPenalties: number;
  championshipScore: number;
  pointsAdjustment: number;
  actualPoints: number;
  races: Race[];
};

type ClassData = {
  carClass: string;
  standings: Standing[];
};

type MergedStanding = {
  position: number;
  id: string;
  carNum: number;
  car: string;
  championshipPoints: number;
  championshipPenalties: number;
  championshipScore: number;
  pointsAdjustment: number;
  actualPoints: number;
  races: Race[];
};

type MergedClassData = {
  carClass: string;
  standings: MergedStanding[];
};

async function readAllJsonFiles(directory: string): Promise<ClassData[]> {
  const files = await readdir(directory);
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  const allData: ClassData[] = [];

  for (const file of jsonFiles) {
    const filePath = join(directory, file);
    const content = await readFile(filePath, "utf-8");
    const data: ClassData[] = JSON.parse(content);
    allData.push(...data);
  }

  return allData;
}

function mergeStandingsByDriver(standings: Standing[]): MergedStanding[] {
  const driverMap = new Map<string, MergedStanding>();

  for (const standing of standings) {
    const existing = driverMap.get(standing.id);

    if (existing) {
      existing.championshipPoints += standing.championshipPoints;
      existing.championshipPenalties += standing.championshipPenalties;
      existing.championshipScore += standing.championshipScore;
      existing.pointsAdjustment += standing.pointsAdjustment;
      existing.actualPoints += standing.actualPoints;
      existing.races.push(...standing.races);
    } else {
      driverMap.set(standing.id, {
        position: 0,
        id: standing.id,
        carNum: standing.carNum,
        car: standing.car,
        championshipPoints: standing.championshipPoints,
        championshipPenalties: standing.championshipPenalties,
        championshipScore: standing.championshipScore,
        pointsAdjustment: standing.pointsAdjustment,
        actualPoints: standing.actualPoints,
        races: [...standing.races],
      });
    }
  }

  return Array.from(driverMap.values());
}

function sortStandingsByPoints(standings: MergedStanding[]): MergedStanding[] {
  return standings.sort((a, b) => {
    if (b.championshipPoints !== a.championshipPoints) {
      return b.championshipPoints - a.championshipPoints;
    }
    return b.championshipScore - a.championshipScore;
  });
}

function assignPositions(standings: MergedStanding[]): MergedStanding[] {
  return standings.map((standing, index) => ({
    ...standing,
    position: index + 1,
  }));
}


function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + ".";
}

function formatResultsForDiscord(results: MergedClassData[]): string {
  const lines: string[] = [];
  
  // Fixed column widths for proper alignment
  const POS_WIDTH = 4;  // " 1. " format
  const DRIVER_WIDTH = 15;
  const CAR_WIDTH = 13;
  const POINTS_WIDTH = 3;  // "101" format
  
  lines.push("🏁 **Standings**\n");
  
  for (const classData of results) {
    lines.push(`**${classData.carClass}**`);
    lines.push("```");
    
    for (const standing of classData.standings) {
      const pos = `${standing.position}.`.padStart(POS_WIDTH);
      const driver = truncateText(standing.id.trim(), DRIVER_WIDTH).padEnd(DRIVER_WIDTH);
      const car = truncateText(standing.car.trim(), CAR_WIDTH).padEnd(CAR_WIDTH);
      const points = standing.championshipPoints.toFixed(0).padStart(POINTS_WIDTH);
      
      lines.push(`${pos} ${driver} | ${car} | ${points}`);
    }
    
    lines.push("```\n");
  }
  
  return lines.join("\n");
}

async function mergeAndSortResults(): Promise<void> {
  const baseDir = (import.meta as { dir?: string }).dir || process.cwd();
  const intakeDir = join(baseDir, "intake");
  const allClassData = await readAllJsonFiles(intakeDir);

  const classMap = new Map<string, Standing[]>();

  for (const classData of allClassData) {
    const existing = classMap.get(classData.carClass);
    if (existing) {
      existing.push(...classData.standings);
    } else {
      classMap.set(classData.carClass, [...classData.standings]);
    }
  }

  const mergedResults: MergedClassData[] = [];

  for (const [carClass, standings] of classMap.entries()) {
    const mergedStandings = mergeStandingsByDriver(standings);
    const sortedStandings = sortStandingsByPoints(mergedStandings);
    const standingsWithPositions = assignPositions(sortedStandings);

    mergedResults.push({
      carClass,
      standings: standingsWithPositions,
    });
  }

  mergedResults.sort((a, b) => a.carClass.localeCompare(b.carClass));

  const discordMessage = formatResultsForDiscord(mergedResults);
  const resultFilePath = join(baseDir, "result.txt");
  
  await writeFile(resultFilePath, discordMessage, "utf-8");
  
  console.log("Results formatted and written to result.txt");
  console.log("\n" + discordMessage);
}

mergeAndSortResults().catch((error) => {
  console.error("Error merging results:", error);
  process.exit(1);
});

