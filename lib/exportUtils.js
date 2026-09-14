import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  UnderlineType,
  BorderStyle,
} from 'docx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Helper: Convert base64 data URL to Uint8Array
function dataUrlToUint8Array(dataUrl) {
  const parts = dataUrl.split(',');
  const byteString = atob(parts[1]);
  const u8 = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    u8[i] = byteString.charCodeAt(i);
  }
  return u8;
}

// Helper: Ensure images (especially WebP/SVG) are converted to Word-supported PNG/JPEG bytes
async function prepareImageForDocx(src, naturalWidth, naturalHeight) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let origW = naturalWidth > 0 ? naturalWidth : (img.naturalWidth || 400);
      let origH = naturalHeight > 0 ? naturalHeight : (img.naturalHeight || 300);

      // If custom width was set by user, preserve aspect ratio accurately
      if (naturalWidth > 0 && (!naturalHeight || naturalHeight <= 0)) {
        if (img.naturalWidth && img.naturalHeight) {
          origH = Math.round((naturalWidth / img.naturalWidth) * img.naturalHeight);
        }
      }

      // Bound image dimensions to max docx page printable width (max 520 pt)
      const maxDocxWidth = 520;
      let targetW = origW;
      let targetH = origH;
      if (targetW > maxDocxWidth) {
        targetH = Math.round((maxDocxWidth / targetW) * targetH);
        targetW = maxDocxWidth;
      }

      // If already PNG or JPEG data URL, we can use bytes directly if dimensions are reasonable
      const isStandardFormat = src.startsWith('data:image/png') || src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg');

      if (isStandardFormat) {
        try {
          const u8 = dataUrlToUint8Array(src);
          resolve({ data: u8, width: targetW, height: targetH });
          return;
        } catch {
          // Fall through to canvas render
        }
      }

      // Convert SVG, WebP, GIF, or blob to PNG via canvas for 100% Word compatibility
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const pngDataUrl = canvas.toDataURL('image/png');
        const u8 = dataUrlToUint8Array(pngDataUrl);
        resolve({ data: u8, width: targetW, height: targetH });
      } catch (err) {
        console.warn('Canvas conversion failed, falling back to raw bytes:', err);
        try {
          resolve({ data: dataUrlToUint8Array(src), width: targetW, height: targetH });
        } catch {
          resolve(null);
        }
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = src;
  });
}

// Recursive AST parser that converts HTML DOM tree to docx Paragraphs and Inline Runs
async function parseHtmlToDocxElements(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${htmlString || ''}</body>`, 'text/html');
  const body = doc.body;

  const docxParagraphs = [];

  // Traverse inline nodes within a block container
  async function parseInlineNodes(node, context = {}) {
    const inlineItems = [];

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        if (text) {
          inlineItems.push(
            new TextRun({
              text: text,
              bold: Boolean(context.bold),
              italics: Boolean(context.italics),
              underline: context.underline ? { type: UnderlineType.SINGLE } : undefined,
              strike: Boolean(context.strike),
              font: context.font || 'Georgia',
              size: context.size || 22, // 11pt
              color: context.color || '1a1714',
            })
          );
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();

        if (tag === 'br') {
          inlineItems.push(new TextRun({ break: 1 }));
        } else if (tag === 'b' || tag === 'strong') {
          const sub = await parseInlineNodes(child, { ...context, bold: true });
          inlineItems.push(...sub);
        } else if (tag === 'i' || tag === 'em') {
          const sub = await parseInlineNodes(child, { ...context, italics: true });
          inlineItems.push(...sub);
        } else if (tag === 'u') {
          const sub = await parseInlineNodes(child, { ...context, underline: true });
          inlineItems.push(...sub);
        } else if (tag === 's' || tag === 'strike' || tag === 'del') {
          const sub = await parseInlineNodes(child, { ...context, strike: true });
          inlineItems.push(...sub);
        } else if (tag === 'code') {
          const sub = await parseInlineNodes(child, {
            ...context,
            font: 'Courier New',
            size: 20,
          });
          inlineItems.push(...sub);
        } else if (tag === 'a') {
          const href = child.getAttribute('href') || '#';
          const linkChildren = await parseInlineNodes(child, {
            ...context,
            color: '0000cc',
            underline: true,
          });
          inlineItems.push(
            new ExternalHyperlink({
              children: linkChildren.length > 0 ? linkChildren : [
                new TextRun({
                  text: child.innerText || href,
                  style: 'Hyperlink',
                  color: '0000cc',
                  underline: { type: UnderlineType.SINGLE },
                  font: 'Georgia',
                }),
              ],
              link: href,
            })
          );
        } else if (tag === 'img') {
          const src = child.getAttribute('src');
          if (src) {
            const explicitW = parseFloat(child.style?.width) || parseInt(child.getAttribute('width'), 10) || 0;
            const explicitH = parseFloat(child.style?.height) || parseInt(child.getAttribute('height'), 10) || 0;
            const imgData = await prepareImageForDocx(
              src,
              explicitW || child.naturalWidth || child.width,
              explicitH || child.naturalHeight || child.height
            );
            if (imgData) {
              inlineItems.push(
                new ImageRun({
                  data: imgData.data,
                  transformation: {
                    width: imgData.width,
                    height: imgData.height,
                  },
                })
              );
            }
          }
        } else if (tag === 'span') {
          const sub = await parseInlineNodes(child, context);
          inlineItems.push(...sub);
        } else {
          // Any other inline or container tag
          const sub = await parseInlineNodes(child, context);
          inlineItems.push(...sub);
        }
      }
    }

    return inlineItems;
  }

  // Traverse top-level blocks
  async function processBlock(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '';

    if (tag === 'ul') {
      const items = Array.from(node.children).filter(
        (c) => c.tagName && c.tagName.toLowerCase() === 'li'
      );
      for (const li of items) {
        const inlineRuns = await parseInlineNodes(li);
        docxParagraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            children: inlineRuns.length > 0 ? inlineRuns : [new TextRun('')],
            spacing: { before: 40, after: 60, line: 320 },
          })
        );
      }
      return;
    }

    if (tag === 'ol') {
      const items = Array.from(node.children).filter(
        (c) => c.tagName && c.tagName.toLowerCase() === 'li'
      );
      let index = 1;
      for (const li of items) {
        const inlineRuns = await parseInlineNodes(li);
        docxParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${index}.  `,
                bold: true,
                font: 'Georgia',
                size: 22,
              }),
              ...inlineRuns,
            ],
            indent: { left: 400 },
            spacing: { before: 40, after: 60, line: 320 },
          })
        );
        index++;
      }
      return;
    }

    if (tag === 'blockquote') {
      const inlineRuns = await parseInlineNodes(node, { italics: true });
      docxParagraphs.push(
        new Paragraph({
          children: inlineRuns,
          indent: { left: 720 },
          spacing: { before: 100, after: 100, line: 320 },
          border: {
            left: { color: '8e8065', space: 10, style: BorderStyle.SINGLE, size: 12 },
          },
        })
      );
      return;
    }

    if (tag === 'hr') {
      docxParagraphs.push(
        new Paragraph({
          children: [],
          border: {
            bottom: { color: '9f9175', space: 1, style: BorderStyle.SINGLE, size: 6 },
          },
          spacing: { before: 120, after: 120 },
        })
      );
      return;
    }

    // Standalone image block
    if (tag === 'img') {
      const src = node.getAttribute('src');
      if (src) {
        const explicitW = parseFloat(node.style?.width) || parseInt(node.getAttribute('width'), 10) || 0;
        const explicitH = parseFloat(node.style?.height) || parseInt(node.getAttribute('height'), 10) || 0;
        const imgData = await prepareImageForDocx(
          src,
          explicitW || node.naturalWidth || node.width,
          explicitH || node.naturalHeight || node.height
        );
        if (imgData) {
          let docxAlign = AlignmentType.CENTER;
          if (node.style?.marginLeft === '0' || node.style?.textAlign === 'left') {
            docxAlign = AlignmentType.LEFT;
          } else if (node.style?.marginRight === '0' || node.style?.textAlign === 'right') {
            docxAlign = AlignmentType.RIGHT;
          }

          docxParagraphs.push(
            new Paragraph({
              alignment: docxAlign,
              children: [
                new ImageRun({
                  data: imgData.data,
                  transformation: {
                    width: imgData.width,
                    height: imgData.height,
                  },
                }),
              ],
              spacing: { before: 140, after: 140 },
            })
          );
        }
      }
      return;
    }

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const sizes = { 1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 20 };
      const inlineRuns = await parseInlineNodes(node, {
        bold: true,
        size: sizes[level] || 24,
      });
      docxParagraphs.push(
        new Paragraph({
          heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          children: inlineRuns,
          spacing: { before: 200, after: 100 },
        })
      );
      return;
    }

    // Default block (p, div, etc.)
    const inlineRuns = await parseInlineNodes(node);
    docxParagraphs.push(
      new Paragraph({
        children: inlineRuns.length > 0 ? inlineRuns : [new TextRun('')],
        spacing: { before: 60, after: 80, line: 340 }, // 1.4x line height
      })
    );
  }

  // Iterate top level children of body
  const children = Array.from(body.childNodes);
  let pendingInlines = [];

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text && text.trim().length > 0) {
        pendingInlines.push(
          new TextRun({ text, font: 'Georgia', size: 22, color: '1a1714' })
        );
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      const isBlock = [
        'p', 'div', 'ul', 'ol', 'blockquote', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table',
      ].includes(tag);

      if (isBlock) {
        // Flush any pending inlines
        if (pendingInlines.length > 0) {
          docxParagraphs.push(
            new Paragraph({
              children: pendingInlines,
              spacing: { before: 60, after: 80, line: 340 },
            })
          );
          pendingInlines = [];
        }
        await processBlock(child);
      } else {
        const inlines = await parseInlineNodes(child);
        pendingInlines.push(...inlines);
      }
    }
  }

  if (pendingInlines.length > 0) {
    docxParagraphs.push(
      new Paragraph({
        children: pendingInlines,
        spacing: { before: 60, after: 80, line: 340 },
      })
    );
  }

  return docxParagraphs;
}

/**
 * Export Note as a Word Document (.docx)
 * Preserves all formatting, lists, hyperlinks, and images.
 */
export async function exportToDocx(note, sectionName = 'General') {
  if (!note) return;

  const title = (note.title || 'Untitled Note').trim();
  const dateString = new Date(note.updated_at || note.created_at || Date.now()).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Vintage Desk Ledger Header
  const headerParagraphs = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: 'THE ELECTRONIC NOTEPAD',
          font: 'Courier New',
          size: 18, // 9pt
          bold: true,
          color: '6f644f',
          characterSpacing: 40,
        }),
      ],
      spacing: { before: 0, after: 40 },
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `SECTION: ${sectionName.toUpperCase()}   •   DATE: ${dateString}`,
          font: 'Courier New',
          size: 18,
          color: '706b60',
        }),
      ],
      spacing: { before: 0, after: 120 },
      border: {
        bottom: { color: '9f9175', space: 6, style: BorderStyle.SINGLE, size: 8 },
      },
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: title,
          font: 'Georgia',
          size: 40, // 20pt
          bold: true,
          color: '1a1612',
        }),
      ],
      spacing: { before: 200, after: 160 },
      border: {
        bottom: { color: 'b5a98e', space: 6, style: BorderStyle.SINGLE, size: 6 },
      },
    }),
  ];

  // Parse HTML content
  const contentParagraphs = await parseHtmlToDocxElements(note.content || '');

  // Footer / Status
  const footerParagraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: '— End of Ledger Note —',
          font: 'Courier New',
          size: 16,
          italics: true,
          color: '9f9684',
        }),
      ],
      spacing: { before: 400, after: 100 },
      border: {
        top: { color: 'dcd1b3', space: 6, style: BorderStyle.DASHED, size: 6 },
      },
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: [...headerParagraphs, ...contentParagraphs, ...footerParagraphs],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `${title.replace(/[^a-z0-9_-]/gi, '_')}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

/**
 * Export Note as a high-fidelity, multi-page PDF document.
 * Captures the complete rendered note with exact styling, typography, lists, and images.
 */
export async function exportToPdf(note, sectionName = 'General') {
  if (!note) return;

  const title = (note.title || 'Untitled Note').trim();
  const dateString = new Date(note.updated_at || note.created_at || Date.now()).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Create clean offscreen rendering stage matching vintage desk stationery
  const stage = document.createElement('div');
  stage.style.position = 'fixed';
  stage.style.left = '-9999px';
  stage.style.top = '0';
  stage.style.width = '794px'; // Standard A4 width at 96 DPI
  stage.style.backgroundColor = '#ffffff';
  stage.style.color = '#1a1612';
  stage.style.fontFamily = 'Georgia, "Times New Roman", Times, serif';
  stage.style.fontSize = '14px';
  stage.style.lineHeight = '1.8';
  stage.style.padding = '48px 56px';
  stage.style.boxSizing = 'border-box';
  stage.style.zIndex = '-1000';

  // Build authentic vintage stationery header and body
  stage.innerHTML = `
    <div style="border-bottom: 2px solid #6f644f; padding-bottom: 8px; margin-bottom: 20px; font-family: 'Courier New', Courier, monospace;">
      <div style="font-size: 11px; font-weight: bold; letter-spacing: 2px; color: #8c2b2b; text-transform: uppercase;">
        THE ELECTRONIC NOTEPAD • DESK LEDGER
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; color: #554d3f; margin-top: 4px;">
        <span><strong>FOLDER:</strong> ${sectionName}</span>
        <span><strong>DATE:</strong> ${dateString}</span>
      </div>
    </div>
    <div style="border-bottom: 2px solid #1a1612; padding-bottom: 10px; margin-bottom: 24px;">
      <h1 style="font-size: 26px; font-weight: bold; margin: 0; color: #1a1612; font-family: Georgia, serif; line-height: 1.3;">
        ${title}
      </h1>
    </div>
    <div id="pdf-body-content" style="font-size: 14px; line-height: 28px; word-break: break-word; color: #1a1714;">
      ${note.content || '<p style="color: #888; font-style: italic;">(Empty note)</p>'}
    </div>
    <div style="margin-top: 40px; padding-top: 12px; border-top: 1px dashed #b5a98e; font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #8c8270; text-align: center;">
      — Preserved from NeonDB Desk Ledger —
    </div>
  `;

  // Apply retro image and link styles inside the container
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    #pdf-body-content a {
      color: #0000cc !important;
      text-decoration: underline !important;
      font-weight: 600;
    }
    #pdf-body-content img {
      max-width: 100% !important;
      height: auto !important;
      display: block;
      margin: 16px auto;
      border: 1px solid #8e8065;
      box-shadow: 2px 3px 6px rgba(0,0,0,0.15);
      border-radius: 2px;
    }
    #pdf-body-content ul, #pdf-body-content ol {
      margin: 12px 0 12px 24px;
      padding-left: 12px;
    }
    #pdf-body-content li {
      margin-bottom: 6px;
    }
    #pdf-body-content blockquote {
      border-left: 3px solid #8e8065;
      padding-left: 12px;
      margin: 12px 0;
      color: #554d3f;
      font-style: italic;
    }
  `;
  stage.appendChild(styleTag);
  document.body.appendChild(stage);

  try {
    // Wait for all images inside the stage to load
    const images = Array.from(stage.querySelectorAll('img'));
    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          })
      )
    );

    // Render offscreen stage to high-resolution canvas (scale: 2 for 300 DPI equivalent)
    const canvas = await html2canvas(stage, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = 210; // A4 width in mm
    const pdfHeight = 297; // A4 height in mm
    const margin = 10; // 10mm margin
    const printableWidth = pdfWidth - margin * 2;
    const printableHeight = pdfHeight - margin * 2;

    const imgWidthPx = canvas.width;
    const imgHeightPx = canvas.height;
    const pageHeightPx = Math.floor((printableHeight / printableWidth) * imgWidthPx);

    let renderedHeight = 0;
    let pageIndex = 0;

    while (renderedHeight < imgHeightPx) {
      if (pageIndex > 0) {
        pdf.addPage();
      }

      const chunkHeight = Math.min(pageHeightPx, imgHeightPx - renderedHeight);

      // Create a page-sized slice canvas
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = imgWidthPx;
      pageCanvas.height = chunkHeight;
      const pageCtx = pageCanvas.getContext('2d');

      pageCtx.drawImage(
        canvas,
        0,
        renderedHeight,
        imgWidthPx,
        chunkHeight,
        0,
        0,
        imgWidthPx,
        chunkHeight
      );

      const pageImgData = pageCanvas.toDataURL('image/png');
      const renderedHeightMm = (chunkHeight / imgWidthPx) * printableWidth;

      pdf.addImage(pageImgData, 'PNG', margin, margin, printableWidth, renderedHeightMm);

      renderedHeight += chunkHeight;
      pageIndex++;
    }

    pdf.save(`${title.replace(/[^a-z0-9_-]/gi, '_')}.pdf`);
  } catch (err) {
    console.error('PDF export error:', err);
    alert('Failed to generate PDF document. Please try again.');
  } finally {
    document.body.removeChild(stage);
  }
}
