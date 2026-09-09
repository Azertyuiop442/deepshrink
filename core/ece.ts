










export interface CalibrationBin {
	binStart: number;
	binEnd: number;
	count: number;
	avgConfidence: number;
	empiricalAccuracy: number;
	gap: number;          
}

export interface EceResult {
	ece: number;          
	bins: CalibrationBin[];
	totalSamples: number;
}

const DEFAULT_BINS = 10;

export function expectedCalibrationError(samples: Array<{ confidence: number; hit: boolean }>, numBins = DEFAULT_BINS): EceResult {
	const bins: CalibrationBin[] = [];
	for (let i = 0; i < numBins; i++) {
		bins.push({ binStart: i / numBins, binEnd: (i + 1) / numBins, count: 0, avgConfidence: 0, empiricalAccuracy: 0, gap: 0 });
	}
	for (const s of samples) {
		const c = Math.max(0, Math.min(0.9999, s.confidence));
		const idx = Math.min(numBins - 1, Math.floor(c * numBins));
		const bin = bins[idx];
		bin.count++;
		bin.avgConfidence += c;
		bin.empiricalAccuracy += s.hit ? 1 : 0;
	}
	let ece = 0;
	let total = 0;
	for (const bin of bins) {
		if (bin.count > 0) {
			bin.avgConfidence /= bin.count;
			bin.empiricalAccuracy /= bin.count;
			bin.gap = bin.avgConfidence - bin.empiricalAccuracy;
			ece += bin.count * Math.abs(bin.gap);
			total += bin.count;
		}
	}
	if (total > 0) ece /= total;
	return { ece, bins, totalSamples: total };
}
