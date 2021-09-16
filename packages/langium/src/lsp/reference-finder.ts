/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Location, Range, TextDocumentPositionParams } from 'vscode-languageserver';
import { LangiumDocument } from '../documents/document';
import { AstNodeLocator } from '../index/ast-node-locator';
import { IndexManager } from '../index/index-manager';
import { NameProvider } from '../references/naming';
import { References } from '../references/references';
import { LangiumServices } from '../services';
import { AstNode, CstNode } from '../syntax-tree';
import { findLeafNodeAtOffset, findLocalReferences, getDocument } from '../utils/ast-util';
import { flatten, toRange } from '../utils/cst-util';

export interface ReferenceFinder {
    findReferences(document: LangiumDocument, params: TextDocumentPositionParams, includeDeclaration: boolean): Location[];
}

export class DefaultReferenceFinder implements ReferenceFinder {
    protected readonly nameProvider: NameProvider;
    protected readonly references: References;
    protected readonly index: IndexManager;
    protected readonly nodeLocator: AstNodeLocator;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.references = services.references.References;
        this.index = services.index.IndexManager;
        this.nodeLocator = services.index.AstNodeLocator;
    }

    findReferences(document: LangiumDocument, params: TextDocumentPositionParams, includeDeclaration: boolean): Location[] {
        const rootNode = document.parseResult.value.$cstNode;
        if (!rootNode) {
            return [];
        }
        const refs: Array<{ docUri: string, range: Range }> = [];
        const selectedNode = findLeafNodeAtOffset(rootNode, document.textDocument.offsetAt(params.position));
        if (!selectedNode) {
            return [];
        }
        const targetAstNode = this.references.findDeclaration(selectedNode)?.element;
        if (targetAstNode) {
            if (includeDeclaration) {
                const declDoc = getDocument(targetAstNode);
                const nameNode = this.findNameNode(targetAstNode, selectedNode.text);
                if (nameNode)
                    refs.push({ docUri: declDoc.textDocument.uri, range: toRange(nameNode, declDoc) });
            }
            findLocalReferences(targetAstNode, rootNode.element).forEach((element) => {
                refs.push({ docUri: document.textDocument.uri, range: toRange(element.$refNode, document) });
            });
            this.index.findAllReferences(targetAstNode, this.nodeLocator.getAstNodePath(targetAstNode)).forEach((refDescr) => {
                const range = Range.create(document.textDocument.positionAt(refDescr.start), document.textDocument.positionAt(refDescr.end));
                refs.push({ docUri: refDescr.sourceUri, range });
            });
        }
        return refs.map(ref => Location.create(
            ref.docUri,
            ref.range
        ));
    }

    protected findNameNode(node: AstNode, name: string): CstNode | undefined {
        const nameNode = this.nameProvider.getNameNode(node);
        if (nameNode)
            return nameNode;
        if (node.$cstNode) {
            // try find first leaf with name as text
            const leafNode = flatten(node.$cstNode).find((n) => n.text === name);
            if (leafNode)
                return leafNode;
        }
        return node.$cstNode;
    }
}
