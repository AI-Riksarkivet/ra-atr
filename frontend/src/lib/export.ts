/**
 * Export transcriptions in ALTO XML, PAGE XML, plain text, and JSON formats.
 */

import type { ImageDocument, Line } from './types';

// --- Plain Text ---

export function exportPlainText(doc: ImageDocument): string {
	const lines = doc.lines.filter((l) => l.text && l.complete);
	lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
	return lines.map((l) => l.text).join('\n');
}

// --- JSON ---

export function exportJSON(doc: ImageDocument): string {
	const lines = doc.lines
		.filter((l) => l.complete)
		.map((l) => ({
			text: l.text,
			confidence: l.confidence,
			bbox: { x: l.bbox.x, y: l.bbox.y, w: l.bbox.w, h: l.bbox.h },
			polygon: l.bbox.polygon ?? null,
		}));

	const groups = doc.groups.map((g) => ({
		name: g.name,
		rect: g.rect ?? null,
		lines: g.lineIds
			.map((id) => doc.lines.find((l) => l.id === id))
			.filter((l): l is Line => !!l && l.complete)
			.map((l) => ({
				text: l.text,
				confidence: l.confidence,
				bbox: { x: l.bbox.x, y: l.bbox.y, w: l.bbox.w, h: l.bbox.h },
			})),
	}));

	return JSON.stringify({ name: doc.name, groups, lines }, null, 2);
}

// --- ALTO XML 4.4 ---

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function exportAltoXML(doc: ImageDocument): string {
	const lines = doc.lines.filter((l) => l.text && l.complete);
	lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

	const now = new Date().toISOString();
	const textLines = lines
		.map((l, i) => {
			const words = l.text.split(/\s+/).filter(Boolean);
			let xPos = Math.round(l.bbox.x);
			const wordWidth = words.length > 0 ? Math.round(l.bbox.w / words.length) : 0;

			const strings = words
				.map((w, wi) => {
					const sx = xPos;
					xPos += wordWidth;
					return `            <String ID="string_${i}_${wi}" CONTENT="${escapeXml(w)}" HPOS="${sx}" VPOS="${Math.round(l.bbox.y)}" WIDTH="${wordWidth}" HEIGHT="${Math.round(l.bbox.h)}" WC="${l.confidence.toFixed(3)}"/>`;
				})
				.join('\n');

			return `          <TextLine ID="line_${i}" HPOS="${Math.round(l.bbox.x)}" VPOS="${Math.round(l.bbox.y)}" WIDTH="${Math.round(l.bbox.w)}" HEIGHT="${Math.round(l.bbox.h)}">\n${strings}\n          </TextLine>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.loc.gov/standards/alto/ns-v4# http://www.loc.gov/standards/alto/v4/alto-4-4.xsd">
  <Description>
    <MeasurementUnit>pixel</MeasurementUnit>
    <sourceImageInformation>
      <fileName>${escapeXml(doc.name)}</fileName>
    </sourceImageInformation>
    <Processing ID="proc_0">
      <processingDateTime>${now}</processingDateTime>
      <processingSoftware>
        <softwareName>RA-ATR</softwareName>
      </processingSoftware>
    </Processing>
  </Description>
  <Layout>
    <Page ID="page_0" PHYSICAL_IMG_NR="0" WIDTH="${Math.round(lines[0]?.bbox?.x + lines[0]?.bbox?.w || 0)}" HEIGHT="${Math.round(lines[lines.length - 1]?.bbox?.y + lines[lines.length - 1]?.bbox?.h || 0)}">
      <PrintSpace>
        <TextBlock ID="block_0">
${textLines}
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`;
}

// --- PAGE XML 2019 ---

export function exportPageXML(doc: ImageDocument): string {
	const lines = doc.lines.filter((l) => l.text && l.complete);
	lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

	const now = new Date().toISOString();

	// Group lines by their LineGroup regions
	const regionBlocks: {
		rect: { x: number; y: number; w: number; h: number };
		lines: Line[];
	}[] = [];

	for (const group of doc.groups) {
		const groupLines = group.lineIds
			.map((id) => lines.find((l) => l.id === id))
			.filter((l): l is Line => !!l);
		if (groupLines.length > 0) {
			regionBlocks.push({
				rect: group.rect ?? {
					x: Math.min(...groupLines.map((l) => l.bbox.x)),
					y: Math.min(...groupLines.map((l) => l.bbox.y)),
					w:
						Math.max(...groupLines.map((l) => l.bbox.x + l.bbox.w)) -
						Math.min(...groupLines.map((l) => l.bbox.x)),
					h:
						Math.max(...groupLines.map((l) => l.bbox.y + l.bbox.h)) -
						Math.min(...groupLines.map((l) => l.bbox.y)),
				},
				lines: groupLines,
			});
		}
	}

	// Fallback: if no groups, put all lines in one region
	if (regionBlocks.length === 0 && lines.length > 0) {
		regionBlocks.push({
			rect: {
				x: Math.min(...lines.map((l) => l.bbox.x)),
				y: Math.min(...lines.map((l) => l.bbox.y)),
				w:
					Math.max(...lines.map((l) => l.bbox.x + l.bbox.w)) -
					Math.min(...lines.map((l) => l.bbox.x)),
				h:
					Math.max(...lines.map((l) => l.bbox.y + l.bbox.h)) -
					Math.min(...lines.map((l) => l.bbox.y)),
			},
			lines,
		});
	}

	function coordsStr(x: number, y: number, w: number, h: number): string {
		return `${Math.round(x)},${Math.round(y)} ${Math.round(x + w)},${Math.round(y)} ${Math.round(x + w)},${Math.round(y + h)} ${Math.round(x)},${Math.round(y + h)}`;
	}

	const regions = regionBlocks
		.map((region, ri) => {
			const textLines = region.lines
				.map((l, li) => {
					const points = l.bbox.polygon
						? l.bbox.polygon.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')
						: coordsStr(l.bbox.x, l.bbox.y, l.bbox.w, l.bbox.h);
					return `        <TextLine id="line_r${ri}_l${li}" custom="readingOrder {index:${li};}">
          <Coords points="${points}"/>
          <TextEquiv conf="${l.confidence.toFixed(3)}">
            <Unicode>${escapeXml(l.text)}</Unicode>
          </TextEquiv>
        </TextLine>`;
				})
				.join('\n');

			const rCoords = coordsStr(region.rect.x, region.rect.y, region.rect.w, region.rect.h);
			return `      <TextRegion id="region_${ri}" custom="readingOrder {index:${ri};}">
        <Coords points="${rCoords}"/>
${textLines}
      </TextRegion>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15 http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15/pagecontent.xsd">
  <Metadata>
    <Creator>RA-ATR</Creator>
    <Created>${now}</Created>
  </Metadata>
  <Page imageFilename="${escapeXml(doc.name)}">
    <ReadingOrder>
      <OrderedGroup id="reading_order">
${regionBlocks.map((_, i) => `        <RegionRefIndexed index="${i}" regionRef="region_${i}"/>`).join('\n')}
      </OrderedGroup>
    </ReadingOrder>
${regions}
  </Page>
</PcGts>`;
}

// --- Download helper ---

export function downloadFile(content: string, filename: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export type ExportFormat = 'txt' | 'alto' | 'page' | 'json';

export function exportDocument(doc: ImageDocument, format: ExportFormat) {
	const baseName = doc.name.replace(/\.[^.]+$/, '');

	switch (format) {
		case 'txt':
			downloadFile(exportPlainText(doc), `${baseName}.txt`, 'text/plain');
			break;
		case 'alto':
			downloadFile(exportAltoXML(doc), `${baseName}_alto.xml`, 'application/xml');
			break;
		case 'page':
			downloadFile(exportPageXML(doc), `${baseName}_page.xml`, 'application/xml');
			break;
		case 'json':
			downloadFile(exportJSON(doc), `${baseName}.json`, 'application/json');
			break;
	}
}
